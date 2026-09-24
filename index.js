const dotenv = require('dotenv');

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: 'env.txt', quiet: true });

const fs = require('fs');
const prism = require('prism-media');

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

function resolveFfmpeg() {
  if (FFMPEG_OVERRIDE && fs.existsSync(FFMPEG_OVERRIDE)) {
    const originalGetInfo = prism.FFmpeg.getInfo.bind(prism.FFmpeg);

    prism.FFmpeg.getInfo = (force = false) => {
      if (FFMPEG_OVERRIDE && fs.existsSync(FFMPEG_OVERRIDE)) {
        return {
          command: FFMPEG_OVERRIDE,
          output: 'ffmpeg version custom',
          version: 'custom'
        };
      }

      return originalGetInfo(force);
    };

    return { source: 'FFMPEG_BIN', path: FFMPEG_OVERRIDE };
  }

  try {
    const info = prism.FFmpeg.getInfo();
    const source = String(info.command).includes('node_modules')
      ? 'ffmpeg-static'
      : 'System-FFmpeg';

    return { source, path: info.command };
  } catch (error) {
    console.warn(`[FFMPEG] FFmpeg nicht gefunden: ${error.message}`);
    return null;
  }
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
let ffmpegStream = null;
let restartTimer = null;
let starting = false;
let shuttingDown = false;

function log(message) {
  console.log(`[${new Date().toLocaleString('de-DE')}] ${message}`);
}

log(`Starte MB ANTENNE 1 Bot (Node.js ${process.version}) ...`);

function stopFfmpeg() {
  if (!ffmpegStream) return;

  try {
    ffmpegStream.destroy();
  } catch {}

  ffmpegStream = null;
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
  log(`FFmpeg-Befehl: ${ffmpeg.path}`);

  const stream = new prism.FFmpeg({
    args: [
      '-nostdin',
      '-hide_banner',
      '-loglevel', 'warning',
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_at_eof', '1',
      '-reconnect_delay_max', '5',
      '-user_agent', 'Mozilla/5.0 MB-Antenne1-DiscordBot/1.3',
      '-i', RADIO_URL,
      '-vn',
      '-map', '0:a:0',
      '-ac', '2',
      '-ar', '48000',
      '-c:a', 'libopus',
      '-b:a', '128k',
      '-application', 'audio',
      '-f', 'ogg'
    ]
  });

  ffmpegStream = stream;

  if (stream.process?.stderr) {
    stream.process.stderr.setEncoding('utf8');
    stream.process.stderr.on('data', data => {
      const msg = data.trim();
      if (msg) console.log(`[FFMPEG] ${msg}`);
    });
  }

  stream.on('error', error => {
    console.error('[FFMPEG] Stream-Fehler:', error.message);

    if (ffmpegStream === stream) ffmpegStream = null;
    starting = false;
    scheduleRadioRestart(10000);
  });

  stream.process?.on('close', (code, signal) => {
    if (ffmpegStream === stream) ffmpegStream = null;

    log(`FFmpeg beendet (Code: ${code}, Signal: ${signal || 'keins'}).`);
    starting = false;

    if (!shuttingDown) {
      scheduleRadioRestart();
    }
  });

  const resource = createAudioResource(stream, {
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
