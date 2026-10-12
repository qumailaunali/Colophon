import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

const tts = new MsEdgeTTS();
const timeout = setTimeout(() => {
  console.error('Edge TTS probe timed out');
  tts.close();
  process.exit(1);
}, 20000);
try {
  await tts.setMetadata('en-US-AvaNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream('This is a Colophon speech connection test.', { rate: '0%', pitch: '0%' });
  let bytes = 0;
  for await (const chunk of audioStream) bytes += chunk.length;
  if (!bytes) throw new Error('No audio returned');
  console.log(`Edge TTS probe passed: ${bytes} MP3 bytes`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  tts.close();
}
