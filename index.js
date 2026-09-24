require('dotenv').config({ quiet: true });

const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const {
  Client,
  Events,
  GatewayIntentBits,
  ActivityType,
  ChannelType
} = require('discord.js');

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  StreamType,
  entersState
} = require('@discordjs/voice');

const TOKEN = (
  process.env.BOT_TOKEN ||
  process.env.DISCORD_TOKEN ||
  process.env.TOKEN ||
  ''
).trim();
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID || '';
const VOICE_CHANNEL_NAME = process.env.VOICE_CHANNEL_NAME || 'Warteraum';
const FFMPEG_OVERRIDE = (process.env.FFMPEG_BIN || '').trim();

const RADIO_URL =
  process.env.RADIO_URL ||
  'https://streams.antenne1.de/a1stg/mp3-128/streams.antenne1.de/';


function ffmpegWorks(binary) {
  if (!binary) return false;

  try {
    const result = spawnSync(binary, ['-version'], {
      stdio: 'ignore',
      timeout: 5000
    });

    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

function resolveFfmpeg() {
  // 1. Optionaler eigener Pfad aus der .env / dem Hosting-Panel
  if (FFMPEG_OVERRIDE) {
    if (ffmpegWorks(FFMPEG_OVERRIDE)) {
      return { binary: FFMPEG_OVERRIDE, source: 'FFMPEG_BIN' };
    }

    console.warn(`[FFMPEG] FFMPEG_BIN \"${FFMPEG_OVERRIDE}\" funktioniert nicht. Suche Alternative ...`);
  }

  // 2. Bevorzugt das FFmpeg des Hostsystems
  if (ffmpegWorks('ffmpeg')) {
    return { binary: 'ffmpeg', source: 'System-FFmpeg' };
  }

  // 3. Fallback fuer Bot-Hoster ohne vorinstalliertes FFmpeg
  try {
    const staticFfmpeg = require('ffmpeg-static');

    if (staticFfmpeg && fs.existsSync(staticFfmpeg)) {
      return { binary: staticFfmpeg, source: 'ffmpeg-static Fallback' };
    }
  } catch (error) {
    console.warn(`[FFMPEG] ffmpeg-static konnte nicht geladen werden: ${error.message}`);
  }

  return null;
}

if (!TOKEN) {
  console.error('[FEHLER] Bot-Token fehlt.');
  console.error('[FEHLER] Trage BOT_TOKEN in die .env ein oder setze die Variable im Hosting-Panel.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const player = createAudioPlayer({
  behaviors: {
    noSubscriber: NoSubscriberBehavior.Play
  }
});

let connection = null;
let ffmpegProcess = null;
let restartTimer = null;
let starting = false;
let shuttingDown = false;

function log(message) {
  console.log(`[${new Date().toLocaleString('de-DE')}] ${message}`);
}

log(`Starte MB ANTENNE 1 Bot (Node.js ${process.version}) ...`);

function stopFfmpeg() {
  if (!ffmpegProcess) return;

  try {
    ffmpegProcess.kill('SIGTERM');
  } catch {}

  ffmpegProcess = null;
}

function scheduleRadioRestart(delay = 5000) {
  if (shuttingDown || restartTimer) return;

  log(`Radio wird in ${delay / 1000} Sekunden neu gestartet ...`);

  restartTimer = setTimeout(() => {
    restartTimer = null;
    startRadio();
  }, delay);
}

function startRadio() {
  if (starting || shuttingDown) return;
  starting = true;

  stopFfmpeg();

  const ffmpeg = resolveFfmpeg();

  if (!ffmpeg) {
    console.error('[FFMPEG] Kein nutzbares FFmpeg gefunden.');
    console.error('[FFMPEG] Installiere die npm-Abhaengigkeiten neu mit: npm install');
    starting = false;
    scheduleRadioRestart(15000);
    return;
  }

  log(`Starte ANTENNE 1 Stream über ${ffmpeg.source} ...`);
  log(`FFmpeg-Befehl: ${ffmpeg.binary}`);

  const args = [
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'warning',

    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_at_eof', '1',
    '-reconnect_delay_max', '5',

    '-user_agent', 'Mozilla/5.0 MB-Antenne1-DiscordBot/1.2',

    '-i', RADIO_URL,

    '-vn',
    '-map', '0:a:0',
    '-ac', '2',
    '-ar', '48000',
    '-c:a', 'libopus',
    '-b:a', '128k',
    '-application', 'audio',
    '-f', 'ogg',
    'pipe:1'
  ];

  const proc = spawn(ffmpeg.binary, args, {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  ffmpegProcess = proc;

  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', data => {
    const msg = data.trim();
    if (msg) console.log(`[FFMPEG] ${msg}`);
  });

  proc.on('error', error => {
    console.error('[FFMPEG] Konnte FFmpeg nicht starten:', error.message);

    if (error.code === 'ENOENT') {
      console.error('[FFMPEG] FFmpeg wurde nicht gefunden. Fuehre im Bot-Ordner npm install aus.');
    }

    if (ffmpegProcess === proc) ffmpegProcess = null;
    starting = false;
    scheduleRadioRestart(10000);
  });

  proc.on('close', (code, signal) => {
    if (ffmpegProcess === proc) ffmpegProcess = null;

    log(`FFmpeg beendet (Code: ${code}, Signal: ${signal || 'keins'}).`);
    starting = false;

    if (!shuttingDown) {
      scheduleRadioRestart();
    }
  });

  const resource = createAudioResource(proc.stdout, {
    inputType: StreamType.OggOpus
  });

  player.play(resource);

  setTimeout(() => {
    starting = false;
  }, 1000);
}

async function findVoiceChannel() {
  if (VOICE_CHANNEL_ID) {
    const channel = await client.channels.fetch(VOICE_CHANNEL_ID).catch(() => null);

    if (channel && channel.isVoiceBased()) {
      return channel;
    }

    log('VOICE_CHANNEL_ID wurde nicht gefunden oder ist kein Sprachkanal.');
  }

  for (const guild of client.guilds.cache.values()) {
    await guild.channels.fetch().catch(() => null);

    const channel = guild.channels.cache.find(ch =>
      (ch.type === ChannelType.GuildVoice ||
       ch.type === ChannelType.GuildStageVoice) &&
      ch.name.toLowerCase() === VOICE_CHANNEL_NAME.toLowerCase()
    );

    if (channel) return channel;
  }

  return null;
}

async function connectVoice() {
  const channel = await findVoiceChannel();

  if (!channel) {
    console.error(
      `[VOICE] Kein Sprachkanal gefunden. Prüfe VOICE_CHANNEL_ID oder "${VOICE_CHANNEL_NAME}".`
    );
    return;
  }

  log(`Verbinde mit "${channel.name}" auf "${channel.guild.name}" ...`);

  connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false
  });

  connection.subscribe(player);

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    if (shuttingDown) return;

    log('Voice-Verbindung getrennt. Versuche Reconnect ...');

    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000)
      ]);
    } catch {
      try { connection.destroy(); } catch {}
      connection = null;
      stopFfmpeg();

      setTimeout(() => {
        connectVoice().catch(console.error);
      }, 5000);
    }
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30000);
    log('Voice-Verbindung steht.');
    startRadio();
  } catch (error) {
    console.error('[VOICE] Verbindung konnte nicht hergestellt werden:', error);

    try { connection.destroy(); } catch {}
    connection = null;

    setTimeout(() => {
      connectVoice().catch(console.error);
    }, 10000);
  }
}

player.on(AudioPlayerStatus.Playing, () => {
  log('ANTENNE 1 läuft.');
});

player.on(AudioPlayerStatus.Idle, () => {
  if (shuttingDown) return;

  log('Radio-Player ist inaktiv/Stream wurde beendet.');
  stopFfmpeg();
  scheduleRadioRestart();
});

player.on('error', error => {
  console.error('[AUDIO] Player-Fehler:', error);
  stopFfmpeg();
  scheduleRadioRestart();
});

async function onBotReady() {
  log(`Bot online als ${client.user.tag}`);

  client.user.setPresence({
    activities: [{
      name: 'ANTENNE 1',
      type: ActivityType.Listening
    }],
    status: 'online'
  });

  await connectVoice();
}

// discord.js v14.22+: clientReady; aeltere Versionen: ready
const readyEvent = Events.ClientReady || 'ready';
client.once(readyEvent, () => {
  onBotReady().catch(error => {
    console.error('[DISCORD] Fehler nach dem Login:', error);
  });
});

client.on('error', error => {
  console.error('[DISCORD] Client-Fehler:', error);
});

process.on('unhandledRejection', error => {
  console.error('[NODE] Unhandled Rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('[NODE] Uncaught Exception:', error);
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  log(`${signal} erhalten. Bot wird beendet ...`);

  if (restartTimer) clearTimeout(restartTimer);

  try { player.stop(true); } catch {}
  stopFfmpeg();
  try { if (connection) connection.destroy(); } catch {}
  try { client.destroy(); } catch {}

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

client.login(TOKEN).catch(error => {
  console.error('[DISCORD] Login fehlgeschlagen:', error.message);

  if (error.code === 'TokenInvalid') {
    console.error('[DISCORD] Der Bot-Token ist ungueltig. Pruefe BOT_TOKEN in der .env.');
  }

  process.exit(1);
});
