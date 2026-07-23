/**
 * A Mineflayer AFK bot pool designed to keep Minecraft servers alive
 * by simulating in-place player behavior.
 */

// --- 1. IMPORTS & EXPRESS KEEP-ALIVE SERVER ---

const mineflayer = require('mineflayer');
const express = require('express');
const config = require('./config.json');

const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('AFK Bot pool is running!');
});

app.listen(port, () => {
  console.log(`[HTTP] Keep-alive web server listening on port ${port}`);
});

// --- 2. CONSTANTS ---

const RECONNECT_DELAY = 30000;      // 30 seconds
const RECONNECT_FAIL_DELAY = 30000; // 30 seconds
const WATCHDOG_TIMEOUT = 45000;     // 45 seconds
const SESSION_DURATION = 10800000;  // 3 hours

// --- 3. GLOBAL HELPER ---

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// --- 4. MAIN BOT FUNCTION ---

function createAndRunBot(username) {
  const currentUsername = username || config.botUsername;
  console.log(`[System] Attempting to connect as ${currentUsername}...`);

  let hasSuccessfullySpawned = false;
  let isDisconnecting = false;
  let lastChatReply = 0;
  let watchdogTimer = null;
  let actionTimer = null;

  const bot = mineflayer.createBot({
    host: config.serverHost,
    port: config.serverPort,
    username: currentUsername,
    auth: 'offline',
    version: config.serverVersion,
    viewDistance: config.viewDistance || 'normal',
    checkTimeoutInterval: WATCHDOG_TIMEOUT,
  });

  function resetWatchdog() {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(forceReconnect, WATCHDOG_TIMEOUT);
  }

  function forceReconnect() {
    console.log(`[System] WATCHDOG: No server tick received for ${WATCHDOG_TIMEOUT / 1000}s. Forcing reconnect...`);
    bot.end('watchdog_timeout');
  }

  function cleanup() {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    if (actionTimer) clearTimeout(actionTimer);
    bot.removeAllListeners();
  }

  function handleDisconnect(reason) {
    if (isDisconnecting) return;
    isDisconnecting = true;

    cleanup();
    console.log(`⛔️ [${currentUsername}] Disconnected/Failed! Reason: ${reason}`);

    if (hasSuccessfullySpawned) {
      console.log(`[${currentUsername}] Reconnecting in ${RECONNECT_DELAY / 1000} seconds...`);
      setTimeout(() => createAndRunBot(currentUsername), RECONNECT_DELAY);
    } else {
      console.log(`[${currentUsername}] Failed to connect. Reconnecting in ${RECONNECT_FAIL_DELAY / 1000} seconds...`);
      setTimeout(() => createAndRunBot(currentUsername), RECONNECT_FAIL_DELAY);
    }
  }

  async function performRandomAction() {
    if (!bot.entity || isDisconnecting) return;

    const actionId = randomInt(0, 5);

    try {
      switch (actionId) {
        case 0: { // Look around
          const yaw = Math.random() * Math.PI * 2 - Math.PI;
          const pitch = (Math.random() * (Math.PI / 2)) - (Math.PI / 4);
          await bot.look(yaw, pitch, false);
          break;
        }

        case 1: { // Swing arm
          const block = bot.findBlock({ matching: (blk) => blk.type !== 0, maxDistance: 3 });
          if (block) {
            await bot.lookAt(block.position, false);
          }
          bot.swingArm();
          setTimeout(() => { if (bot.entity) bot.swingArm(); }, 300);
          break;
        }

        case 2: // Swap hotbar slot
          bot.setQuickBarSlot(randomInt(0, 8));
          break;

        case 3: { // Face nearest player
          const player = bot.nearestEntity((e) => e.type === 'player' && e.username !== bot.username);
          if (player) {
            await bot.lookAt(player.position.offset(0, player.height, 0));
          }
          break;
        }

        case 4: { // Break nearby foliage
          const blockToBreak = bot.findBlock({
            matching: (blk) => ['grass', 'short_grass', 'poppy', 'dandelion', 'dead_bush'].includes(blk.name),
            maxDistance: 4,
          });
          if (blockToBreak && bot.canDigBlock(blockToBreak)) {
            await bot.lookAt(blockToBreak.position.offset(0.5, 0.5, 0.5));
            // Catch dig rejections gracefully to avoid crashing on cancelled block breaks
            await bot.dig(blockToBreak).catch((err) => console.warn(`[${currentUsername}] Dig cancelled: ${err.message}`));
          }
          break;
        }

        case 5: { // Toss excess inventory item
          const items = bot.inventory.items().filter((item) => item.slot >= 9 && item.slot <= 35);
          if (items.length > 0) {
            const itemToToss = items[randomInt(0, items.length - 1)];
            await bot.toss(itemToToss.type, null, 1);
          }
          break;
        }
      }
    } catch (err) {
      console.warn(`[${currentUsername}] Non-fatal action error: ${err.message}`);
    }

    // Stop execution if the bot disconnected while waiting on an async operation
    if (isDisconnecting) return;

    const nextActionDelay = randomInt(2500, 7000);
    actionTimer = setTimeout(performRandomAction, nextActionDelay);
  }

  // --- EVENT LISTENERS ---

  bot.once('spawn', () => {
    hasSuccessfullySpawned = true;
    console.log(`✅ [${currentUsername}] Has spawned in the server!`);

    // 1. Initial Login
    bot.chat('/login sa0011');
    console.log(`[${currentUsername}] Sent /login sa0011.`);

    // 2. Queue join
    setTimeout(() => {
      if (!isDisconnecting) {
        bot.chat('/joinqueue smp');
        console.log(`[${currentUsername}] Sent /joinqueue smp command.`);
      }
    }, 3000);

    // 3. Start action loop
    setTimeout(() => {
      if (!isDisconnecting) {
        console.log(`[${currentUsername}] Starting stationary action cycle...`);
        performRandomAction();
      }
    }, 8000);

    resetWatchdog();

    setTimeout(() => {
      if (!isDisconnecting) bot.end('proactive_session_reconnect');
    }, SESSION_DURATION);
  });

  bot.on('physicTick', resetWatchdog);

  bot.on('chat', (username, message) => {
    if (username === bot.username || isDisconnecting) return;

    const messageLower = message.toLowerCase();
    const botNameLower = currentUsername.toLowerCase();

    if (messageLower.includes(botNameLower)) {
      const now = Date.now();
      if (now - lastChatReply < 30000) return;
      lastChatReply = now;

      const replies = ["Sorry, I'm AFK.", "brb", "zZzZz...", "?"];
      const reply = replies[randomInt(0, replies.length - 1)];

      setTimeout(() => {
        if (!isDisconnecting) bot.chat(reply);
      }, randomInt(1500, 4500));
    }
  });

  bot.on('error', (err) => {
    console.error(`⚠️ [${currentUsername}] Error:`, err.message);
    handleDisconnect(err.message);
  });

  bot.on('kicked', (reason) => {
    hasSuccessfullySpawned = true;
    handleDisconnect(`Kicked: ${JSON.stringify(reason)}`);
  });

  bot.on('end', (reason) => {
    handleDisconnect(`Connection ended: ${reason}`);
  });
}

// --- 5. INITIAL CALL FOR MULTIPLE ACCOUNTS ---

const accounts = ['Aria012', 'Momhameed12', 'jon0123', 'whyimpre'];

accounts.forEach((accountName, index) => {
  setTimeout(() => {
    createAndRunBot(accountName);
  }, index * 30000); // 30-second staggered delay between each connection
});