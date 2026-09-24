MB ANTENNE 1 RADIO BOT - ANIKBOTHOSTING VERSION v1.3.1
=======================================================

Diese Version ist fuer klassisches Node.js Bot-Hosting vorbereitet.
Sie versucht zuerst das FFmpeg des Hostsystems. Wenn dort kein FFmpeg
installiert ist, nutzt sie automatisch das npm-Paket "ffmpeg-static".

WICHTIG:
- Dateien direkt ins Bot-Hauptverzeichnis legen (index.js muss im Root liegen).
- node_modules NICHT mit hochladen. Auf dem Hoster neu installieren.
- Node.js 18 oder neuer verwenden (empfohlen: Node.js 22).
- Startbefehl: npm start

ANIKBOTHOSTING / BOT-HOSTING INSTALLATION
-----------------------------------------
1. Alle Dateien ins Bot-Hauptverzeichnis hochladen (kein Unterordner).
2. Falls das Panel eine Node-Version auswaehlen laesst: Node.js 22 waehlen.
3. Im Terminal/Install-Befehl ausfuehren:

   npm install

4. Die Datei ".env.example" kopieren/umbenennen zu ".env".
5. In der .env mindestens eintragen:

   BOT_TOKEN=DEIN_DISCORD_BOT_TOKEN
   VOICE_CHANNEL_ID=DEINE_VOICE_CHANNEL_ID

   Alternativ: BOT_TOKEN als Umgebungsvariable im Hosting-Panel setzen.

6. Startbefehl im Panel:

   npm start

FFMPEG
------
Der Bot prueft automatisch in dieser Reihenfolge:
1. FFMPEG_BIN aus .env (falls gesetzt)
2. ffmpeg vom Hostsystem
3. ffmpeg-static aus den npm-Abhaengigkeiten

Du musst daher normalerweise KEIN apt install ffmpeg ausfuehren.

FEHLERBEHEBUNG
--------------
"BOT_TOKEN fehlt":
-> .env pruefen und Token eintragen.

"Kein Sprachkanal gefunden":
-> VOICE_CHANNEL_ID pruefen.

"Kein nutzbares FFmpeg gefunden":
-> npm install erneut ausfuehren und Logs pruefen.

"Unsupported engine" oder Node-Version zu alt:
-> Im Hosting-Panel Node.js 22.12 oder neuer waehlen.

LOKAL / EIGENER LINUX-SERVER
----------------------------
npm install
npm start

Optional kannst du weiterhin System-FFmpeg installieren. Dieses wird
vom Bot automatisch bevorzugt.
