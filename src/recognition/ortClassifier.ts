import type * as Ort from 'onnxruntime-web';
import type { DigitClassifier } from './engine';
import { softmax } from './engine';
import { MODEL_SIZE } from './rasterize';

/** I/O names of the ONNX Model Zoo MNIST-12 graph. */
export const MNIST_INPUT = 'Input3';
export const MNIST_OUTPUT = 'Plus214_Output_0';

/**
 * Wrap an ONNX Runtime session of MNIST-12 as a {@link DigitClassifier}.
 * The model has a fixed batch size of 1, so images are run sequentially
 * (each run is ~0.1–0.3 ms on WASM). Tensors are disposed eagerly so long
 * sessions don't accumulate WASM heap.
 */
export function createOrtClassifier(ort: typeof Ort, session: Ort.InferenceSession): DigitClassifier {
  return async (images) => {
    const out: Float32Array[] = [];
    for (const img of images) {
      const input = new ort.Tensor('float32', img, [1, 1, MODEL_SIZE, MODEL_SIZE]);
      const result = await session.run({ [MNIST_INPUT]: input });
      const logits = result[MNIST_OUTPUT]!;
      out.push(softmax(logits.data as Float32Array));
      input.dispose();
      for (const t of Object.values(result)) t.dispose();
    }
    return out;
  };
}
