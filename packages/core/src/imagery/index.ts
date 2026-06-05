// Barrel for the image-quality pipeline (D37) + studio prep (D38).
export {
  createStubBgProvider,
  createLocalRembgProvider,
  createReplicateBgProvider,
  selectBackgroundRemoverFromEnv,
  compositeOntoStudio,
  DEFAULT_STUDIO_BACKDROP,
  DEFAULT_SUBJECT_FRAME,
  type BackgroundRemoverProvider,
  type ImageBytes,
  type StudioBackdrop,
  type CompositeRequest,
  type CompositeResult,
  type ReplicateBgConfig,
} from "./studio.js";

export * from "./types.js";
export { createStage1Provider } from "./stage1.js";
export { createAwsRekognitionProvider, type AwsRekognitionConfig } from "./aws-rekognition.js";
export {
  generateProductDetailsFromImage,
  type GeneratedProductDetails,
} from "./product-generator.js";

export {
  scoreProductImages,
  toImageInput,
  type ScoreProductImagesInput,
  type ProductUpdate,
  type PerImageUpdate,
} from "./service.js";
