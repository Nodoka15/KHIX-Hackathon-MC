import {
  FilesetResolver,
  HandLandmarker,
  NormalizedLandmark
} from '@mediapipe/tasks-vision';

export interface VisionPacket {
  hands: NormalizedLandmark[][];
}

export class VisionPipeline {
  private handLandmarker!: HandLandmarker;
  private isReady = false;

  public async initialize(): Promise<void> {
    const wasmFileset = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );

    this.handLandmarker = await HandLandmarker.createFromOptions(wasmFileset, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6
    });

    this.isReady = true;
  }

  public processFrame(video: HTMLVideoElement, timestamp: number): VisionPacket {
    if (!this.isReady || video.readyState < 2) {
      return { hands: [] };
    }

    const handResults = this.handLandmarker.detectForVideo(video, timestamp);

    return {
      hands: handResults.landmarks
    };
  }
}