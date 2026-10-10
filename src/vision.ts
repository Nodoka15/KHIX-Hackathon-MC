import {
  FilesetResolver,
  HandLandmarker,
  FaceLandmarker,
  NormalizedLandmark
} from '@mediapipe/tasks-vision';

export interface VisionPacket {
  hands: NormalizedLandmark[][];
  faceTransform?: {
    xCenter: number;
    yCenter: number;
    width: number;
    height: number;
  };
}

export class VisionPipeline {
  private handLandmarker!: HandLandmarker;
  private faceLandmarker!: FaceLandmarker;
  private isReady = false;

  public async initialize(): Promise<void> {
    const wasmFileset = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );

    // Modern 21-point Hand Landmarker
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

    // Sub-millimeter Face Mesh for accurate helmet pinning
    this.faceLandmarker = await FaceLandmarker.createFromOptions(wasmFileset, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    this.isReady = true;
  }

  public processFrame(video: HTMLVideoElement, timestamp: number): VisionPacket {
    if (!this.isReady || video.readyState < 2) {
      return { hands: [] };
    }

    const handResults = this.handLandmarker.detectForVideo(video, timestamp);
    const faceResults = this.faceLandmarker.detectForVideo(video, timestamp);

    let faceTransform: VisionPacket['faceTransform'] = undefined;

    if (faceResults.faceLandmarks.length > 0) {
      const landmarks = faceResults.faceLandmarks[0];
      // Compute bounding dimensions from outer face landmarks (10 = forehead top, 152 = chin bottom, 234 = left ear, 454 = right ear)
      const top = landmarks[10];
      const bottom = landmarks[152];
      const left = landmarks[234];
      const right = landmarks[454];

      const width = Math.abs(right.x - left.x);
      const height = Math.abs(bottom.y - top.y);
      const xCenter = (left.x + right.x) / 2;
      const yCenter = (top.y + bottom.y) / 2;

      faceTransform = { xCenter, yCenter, width, height };
    }

    return {
      hands: handResults.landmarks,
      faceTransform
    };
  }
}