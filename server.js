const { spawn } = require('child_process');
const WebSocket = require('ws');
const http = require('http');

// Renderが自動で割り当てるポート番号（デフォルトは10000番）
const PORT = process.env.PORT || 10000;

// HTTPサーバーの作成（Renderの死活監視およびウォームアップ用）
const server = http.createServer((req, res) => {
  // CORSを許可してiPadブラウザからの疎通確認をしやすくする
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('EQLive Stream Server が正常に稼働しています。');
});

// WebSocketサーバーの立ち上げ
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  console.log('iPad からの配信接続を確立しました。');

  let ffmpeg = null;

  // クライアントからデータを受信した時の処理
  ws.on('message', (message) => {
    // 最初のパケット（文字列形式）でストリームキーを受け取る
    if (typeof message === 'string' || Buffer.isBuffer(message) === false) {
      const command = message.toString();
      if (command.startsWith('START:')) {
        const streamKey = command.split('START:')[1].trim();
        const rtmpUrl = `rtmp://a.rtmp.youtube.com/live2/${streamKey}`;
        
        console.log(`FFmpegを起動します。転送先: ${rtmpUrl}`);

        // RenderのFreeプラン（CPU制限）でも安定する超軽量設定
        // 映像はiPad側でエンコードされたH.264をそのままパススルー(copy)し、サーバーの負荷をほぼゼロにします
        ffmpeg = spawn('ffmpeg', [
          '-i', '-',                    // 標準入力からデータを受け取る
          '-vcodec', 'copy',            // 映像は再エンコードせずそのままコピー
          '-acodec', 'aac',             // 音声をYouTube推奨のAACに変換
          '-b:a', '128k',               // 音声ビットレート
          '-f', 'flv',                  // FLV形式にカプセル化
          rtmpUrl                       // YouTubeのRTMPサーバーへ転送
        ]);

        ffmpeg.stdout.on('data', (data) => { console.log(`ffmpeg_info: ${data}`); });
        ffmpeg.stderr.on('data', (data) => { console.error(`ffmpeg_log: ${data}`); });
        
        ffmpeg.on('close', (code) => {
          console.log(`FFmpegが終了しました。コード: ${code}`);
          ws.close();
        });
      }
      return;
    }

    // 2回目以降のバイナリデータ（動画・音声パケット）をFFmpegへ流し込む
    if (ffmpeg && ffmpeg.stdin.writable) {
      ffmpeg.stdin.write(message);
    }
  });

  ws.on('close', () => {
    console.log('iPad との接続が閉じられました。');
    if (ffmpeg) {
      ffmpeg.stdin.end();
      ffmpeg.kill('SIGINT');
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocketエラーが発生しました:', err);
  });
});

// サーバー起動
server.listen(PORT, () => {
  console.log(`EQLive配信用中継サーバーがポート ${PORT} で起動しました。`);
});
