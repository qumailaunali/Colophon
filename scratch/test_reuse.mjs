import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

(async () => {
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata("en-US-AvaNeural", OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    
    // Call 1
    console.time("Synthesis 1");
    const { audioStream: stream1 } = tts.toStream("First sentence test.", { rate: "0%", pitch: "0%" });
    await new Promise((resolve) => {
      stream1.on("data", () => {});
      stream1.on("end", resolve);
    });
    console.timeEnd("Synthesis 1");

    // Call 2 (using same instance)
    console.time("Synthesis 2");
    const { audioStream: stream2 } = tts.toStream("Second sentence test.", { rate: "0%", pitch: "0%" });
    await new Promise((resolve) => {
      stream2.on("data", () => {});
      stream2.on("end", resolve);
    });
    console.timeEnd("Synthesis 2");
    
  } catch (e) {
    console.error("Error:", e);
  }
})();
