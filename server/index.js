const express  = require('express');
const http     = require('http');
const WebSocket = require('ws');
const { execSync, execFile, spawn, exec } = require('child_process');
const path = require('path');
const fs   = require('fs');

const app    = express();
const server = http.createServer(app);
const controlWss = new WebSocket.Server({ noServer: true });
const streamWss  = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/stream')
    streamWss.handleUpgrade(req, socket, head, ws => streamWss.emit('connection', ws));
  else
    controlWss.handleUpgrade(req, socket, head, ws => controlWss.emit('connection', ws));
});

const PORT     = 3000;
const DISPLAY  = process.env.DISPLAY || ':99';
const SCREEN_W = parseInt(process.env.SCREEN_W || '1920');
const SCREEN_H = parseInt(process.env.SCREEN_H || '1080');
const FPS      = 60;

let controller  = null;
const clients   = new Map();
let msgHistory  = [];
let idCounter   = 0;
let ffmpegProc  = null;
let initSegment = null;

// Get Firefox window ID
let firefoxWid = null;
function refreshWid() {
  try {
    const r = execSync(`DISPLAY=${DISPLAY} xdotool search --class firefox 2>/dev/null | tail -1`, { encoding:'utf8' }).trim();
    if (r) { firefoxWid = r; console.log(`[solarcast] Firefox WID: ${firefoxWid}`); }
  } catch(_) {}
}
setTimeout(refreshWid, 5000);
setInterval(refreshWid, 30000);

function xdo(args) {
  const cmd = `DISPLAY=${DISPLAY} xdotool ${args}`;
  exec(cmd, (err, stdout, stderr) => {
    if (err || stderr) console.error(`[xdotool] args="${args}" err=${err?.message?.split('\n')[0]} stderr="${stderr?.trim()}"`);
  });
}

function sendMouseMove(x, y) {
  const ax = Math.round(x * SCREEN_W);
  const ay = Math.round(y * SCREEN_H);
  xdo(`mousemove --sync ${ax} ${ay}`);
}

function sendMouseDown(x, y, btn) {
  const ax = Math.round(x * SCREEN_W);
  const ay = Math.round(y * SCREEN_H);
  xdo(`mousemove ${ax} ${ay} mousedown ${btn}`);
}

function sendMouseUp(x, y, btn) {
  const ax = Math.round(x * SCREEN_W);
  const ay = Math.round(y * SCREEN_H);
  xdo(`mousemove ${ax} ${ay} mouseup ${btn}`);
}

function sendScroll(x, y, dy) {
  const ax = Math.round(x * SCREEN_W);
  const ay = Math.round(y * SCREEN_H);
  const btn = dy > 0 ? 5 : 4;
  xdo(`mousemove ${ax} ${ay} click ${btn}`);
}

function sendKey(key) {
  const win = firefoxWid ? `--window ${firefoxWid}` : '';
  xdo(`key ${win} --clearmodifiers "${key}"`);
}

function sendKeyDown(key) {
  const win = firefoxWid ? `--window ${firefoxWid}` : '';
  xdo(`keydown ${win} --clearmodifiers "${key}"`);
}

function sendKeyUp(key) {
  const win = firefoxWid ? `--window ${firefoxWid}` : '';
  xdo(`keyup ${win} --clearmodifiers "${key}"`);
}

function sendTypeText(text) {
  const args = ['type', '--clearmodifiers', '--delay', '12', '--', String(text)];
  const env = { ...process.env, DISPLAY };
  execFile('xdotool', args, { env }, (err, stdout, stderr) => {
    if (err) console.error('[typeText] xdotool error:', err.message, stderr?.trim());
  });
}


function sendNavigate(url) {
  console.log(`[nav] Opening URL: ${url}`);
  if (!firefoxWid) { console.warn('[nav] No Firefox WID yet'); return; }
  const env = { ...process.env, DISPLAY };
  const win = ['--window', firefoxWid];
  execFile('xdotool', ['key', ...win, '--clearmodifiers', 'ctrl+l'], { env }, (err) => {
    if (err) { console.error('[nav] ctrl+l failed:', err.message); return; }
    setTimeout(() => {
      execFile('xdotool', ['type', ...win, '--clearmodifiers', '--delay', '12', '--', url], { env }, (err) => {
        if (err) { console.error('[nav] type url failed:', err.message); return; }
        setTimeout(() => {
          execFile('xdotool', ['key', ...win, '--clearmodifiers', 'Return'], { env }, (err) => {
            if (err) console.error('[nav] Return failed:', err.message);
          });
        }, 100);
      });
    }, 300);
  });
}

const KEYSYM = {
  ' ':'space', '!':'exclam', '@':'at', '#':'numbersign', '$':'dollar',
  '%':'percent', '^':'asciicircum', '&':'ampersand', '*':'asterisk',
  '(':'parenleft', ')':'parenright', '-':'minus', '_':'underscore',
  '=':'equal', '+':'plus', '[':'bracketleft', ']':'bracketright',
  '{':'braceleft', '}':'braceright', '\\':'backslash', '|':'bar',
  ';':'semicolon', ':':'colon', "'":"apostrophe", '"':'quotedbl',
  ',':'comma', '<':'less', '.':'period', '>':'greater',
  '/':'slash', '?':'question', '`':'grave', '~':'asciitilde',
};

function sendType(char) {
  let key;
  if (KEYSYM[char]) {
    key = KEYSYM[char];
  } else if (char >= 'A' && char <= 'Z') {
    key = 'shift+' + char.toLowerCase();
  } else {
    key = char;
  }
  const win = firefoxWid ? `--window ${firefoxWid}` : '';
  xdo(`keydown ${win} --clearmodifiers "${key}" keyup ${win} --clearmodifiers "${key}"`);
}

function startFFmpeg() {
  console.log(`[solarcast] Starting FFmpeg on ${DISPLAY}...`);
  initSegment = null;

  const args = [
    '-loglevel', 'warning',
    '-thread_queue_size', '512',
    '-f', 'x11grab', '-framerate', String(FPS),
    '-video_size', `${SCREEN_W}x${SCREEN_H}`,
    '-i', `${DISPLAY}.0`,
    '-thread_queue_size', '512',
    '-f', 'pulse', '-i', 'audio_output.monitor',
    '-c:v', 'libx264', '-profile:v', 'baseline', '-level:v', '3.1',
    '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-crf', '28', '-g', '4', '-keyint_min', '4', '-sc_threshold', '0',
    '-bf', '0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '2',
    '-af', 'aresample=async=1:min_hard_comp=0.100000:first_pts=0',
    '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof+omit_tfhd_offset',
    '-frag_duration', '100000',
    'pipe:1',
  ];

  ffmpegProc = spawn('ffmpeg', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PULSE_SERVER: 'unix:/tmp/pulseaudio.socket', DISPLAY },
  });

  let buf = Buffer.alloc(0);
  ffmpegProc.stdout.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8) {
      const size = buf.readUInt32BE(0);
      if (size < 8 || buf.length < size) break;
      const type = buf.slice(4, 8).toString('ascii');
      const box  = buf.slice(0, size);
      buf = buf.slice(size);
      if (type === 'ftyp' || type === 'moov') {
        initSegment = initSegment ? Buffer.concat([initSegment, box]) : box;
        if (type === 'moov') {
          console.log(`[solarcast] Init segment ready (${initSegment.length} bytes)`);
          for (const ws of streamWss.clients)
            if (ws.readyState === WebSocket.OPEN) ws.send(initSegment);
        }
      } else if (type === 'moof' || type === 'mdat') {
        for (const ws of streamWss.clients)
          if (ws.readyState === WebSocket.OPEN) { try { ws.send(box); } catch(_){} }
      }
    }
  });
  ffmpegProc.stderr.on('data', d => process.stdout.write(`[ffmpeg] ${d}`));
  ffmpegProc.on('exit', (code, sig) => {
    if (sig === 'SIGTERM') return;
    console.warn(`[solarcast] FFmpeg exited (${code}), retrying in 3s...`);
    initSegment = null;
    setTimeout(startFFmpeg, 3000);
  });
}

//ws
streamWss.on('connection', ws => {
  ws.binaryType = 'arraybuffer';
  if (initSegment) ws.send(initSegment);
  ws.on('error', () => {});
  ws.on('close', () => {});
});

function broadcastAll(msg) {
  const d = JSON.stringify(msg);
  for (const [ws] of clients) if (ws.readyState === WebSocket.OPEN) ws.send(d);
}
function getState() {
  return {
    viewers: [...clients.values()].map(v => ({ id:v.id, name:v.name, isController:v.isController })),
    controllerId: controller ? clients.get(controller)?.id : null,
  };
}
function broadcastState() { broadcastAll({ type:'state', ...getState() }); }

controlWss.on('connection', ws => {
  const id = ++idCounter;
  const info = { id, name:`Viewer ${id}`, isController:false };
  clients.set(ws, info);
  console.log(`[solarcast] Client ${id} connected`);
  ws.send(JSON.stringify({ type:'welcome', id, name:info.name, history:msgHistory.slice(-50), ...getState() }));
  broadcastState();

  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const info = clients.get(ws); if (!info) return;
    switch (msg.type) {
      case 'setName':
        info.name = String(msg.name).slice(0,32).trim() || info.name;
        broadcastState(); break;
      case 'chat': {
        const text = String(msg.text).slice(0,500).trim(); if (!text) break;
        const entry = { id:info.id, name:info.name, text, ts:Date.now() };
        msgHistory.push(entry); if (msgHistory.length > 200) msgHistory.shift();
        broadcastAll({ type:'chat', ...entry }); break;
      }
      case 'requestControl':
        if (!controller) { controller=ws; info.isController=true; broadcastState(); } break;
      case 'releaseControl':
        if (controller===ws) { controller=null; info.isController=false; broadcastState(); } break;
      case 'mousemove':  if (controller===ws) sendMouseMove(msg.x, msg.y); break;
      case 'mousedown':  if (controller===ws) sendMouseDown(msg.x, msg.y, msg.button||1); break;
      case 'mouseup':    if (controller===ws) sendMouseUp(msg.x, msg.y, msg.button||1); break;
      case 'scroll':     if (controller===ws) sendScroll(msg.x, msg.y, msg.dy); break;
      case 'keydown':    if (controller===ws) { console.log(`[key] keydown: "${msg.key}"`); sendKeyDown(msg.key); } break;
      case 'keyup':      if (controller===ws) { console.log(`[key] keyup: "${msg.key}"`);   sendKeyUp(msg.key);   } break;
      case 'type':       if (controller===ws) { console.log(`[key] type: "${msg.char}"`);   sendType(msg.char);   } break;
      case 'typeText': {
        if (controller===ws) {
          const text = String(msg.text||'').slice(0,1000);
          console.log(`[key] typeText: "${text}"`);
          sendTypeText(text);
        }
        break;
      }
      case 'navigate': {
        if (controller===ws) {
          const url = String(msg.url||'').slice(0,2000).trim();
          console.log(`[nav] navigate: "${url}"`);
          sendNavigate(url);
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws); if (!info) return;
    if (controller===ws) controller=null;
    clients.delete(ws); broadcastState();
    console.log(`[solarcast] Client ${info.id} disconnected`);
  });
  ws.on('error', () => {});
});

app.get('/status', (req, res) => res.json({
  ffmpegRunning: !!ffmpegProc && ffmpegProc.exitCode === null,
  gotInit: !!initSegment,
  streamClients: streamWss.clients.size,
}));
app.use(express.static(path.join(__dirname, '../public')));

server.listen(PORT, () => {
  console.log(`[solarcast] Server on :${PORT}`);
  startFFmpeg();
});