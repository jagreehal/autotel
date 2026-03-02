import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { instrumentImages } from './images';

describe('Images Binding Instrumentation', () => {
  let mockTracer: any;
  let mockSpan: any;
  let getTracerSpy: any;

  beforeEach(() => {
    mockSpan = {
      spanContext: () => ({
        traceId: 'test-trace-id',
        spanId: 'test-span-id',
        traceFlags: 1,
      }),
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
      isRecording: () => true,
      updateName: vi.fn(),
      addEvent: vi.fn(),
    };

    mockTracer = {
      startActiveSpan: vi.fn((name, options, fn) => {
        return fn(mockSpan);
      }),
    };

    getTracerSpy = vi.spyOn(trace, 'getTracer').mockReturnValue(mockTracer as any);
  });

  afterEach(() => {
    getTracerSpy.mockRestore();
  });

  function createMockImages() {
    const mockTransformer: any = {
      transform: vi.fn(function (this: any) {
        return mockTransformer;
      }),
      draw: vi.fn(function (this: any) {
        return mockTransformer;
      }),
      output: vi.fn(async () => ({
        response: () => new Response('image-data'),
        blob: async () => new Blob(['image-data']),
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    };

    return {
      images: {
        info: vi.fn(async () => ({ width: 800, height: 600, format: 'png' })),
        input: vi.fn(() => mockTransformer),
        someOtherMethod: vi.fn(() => 'passthrough'),
        someProperty: 'test-value',
      },
      mockTransformer,
    };
  }

  describe('info()', () => {
    it('should create its own span with correct attributes', async () => {
      const { images } = createMockImages();
      const instrumented = instrumentImages(images as any, 'my-images');

      await instrumented.info(new ArrayBuffer(8));

      expect(mockTracer.startActiveSpan).toHaveBeenCalledTimes(1);

      const [spanName, options] = mockTracer.startActiveSpan.mock.calls[0];
      expect(spanName).toBe('Images my-images: info');
      expect(options.kind).toBe(SpanKind.CLIENT);
      expect(options.attributes['images.system']).toBe('cloudflare-images');
      expect(options.attributes['images.operation']).toBe('info');
    });

    it('should record width, height, format from result', async () => {
      const { images } = createMockImages();
      const instrumented = instrumentImages(images as any, 'my-images');

      await instrumented.info(new ArrayBuffer(8));

      expect(mockSpan.setAttribute).toHaveBeenCalledWith('images.width', 800);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('images.height', 600);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('images.format', 'png');
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      const { images } = createMockImages();
      const testError = new Error('Image info failed');
      images.info = vi.fn(async () => {
        throw testError;
      });
      const instrumented = instrumentImages(images as any, 'my-images');

      await expect(instrumented.info(new ArrayBuffer(8))).rejects.toThrow('Image info failed');

      expect(mockSpan.recordException).toHaveBeenCalledWith(testError);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'Image info failed',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe('pipeline: input() -> output()', () => {
    it('should create a single span at output() with operation_count = 0', async () => {
      const { images } = createMockImages();
      const instrumented = instrumentImages(images as any, 'my-images');

      const transformer = instrumented.input(new ArrayBuffer(8));
      await transformer.output();

      // Only one span created at output(), not at input()
      expect(mockTracer.startActiveSpan).toHaveBeenCalledTimes(1);

      const [spanName, options] = mockTracer.startActiveSpan.mock.calls[0];
      expect(spanName).toBe('Images my-images: output');
      expect(options.attributes['images.system']).toBe('cloudflare-images');
      expect(options.attributes['images.pipeline.operation_count']).toBe(0);
    });
  });

  describe('pipeline: input() -> transform() -> output()', () => {
    it('should create span with operation_count = 1', async () => {
      const { images } = createMockImages();
      const instrumented = instrumentImages(images as any, 'my-images');

      const transformer = instrumented.input(new ArrayBuffer(8));
      const transformed = transformer.transform({ width: 400 });
      await transformed.output();

      expect(mockTracer.startActiveSpan).toHaveBeenCalledTimes(1);

      const [, options] = mockTracer.startActiveSpan.mock.calls[0];
      expect(options.attributes['images.pipeline.operation_count']).toBe(1);
    });
  });

  describe('pipeline: input() -> transform() -> draw() -> output()', () => {
    it('should create span with operation_count = 2', async () => {
      const { images } = createMockImages();
      const instrumented = instrumentImages(images as any, 'my-images');

      const transformer = instrumented.input(new ArrayBuffer(8));
      const transformed = transformer.transform({ width: 400 });
      const drawn = transformed.draw({});
      await drawn.output();

      expect(mockTracer.startActiveSpan).toHaveBeenCalledTimes(1);

      const [, options] = mockTracer.startActiveSpan.mock.calls[0];
      expect(options.attributes['images.pipeline.operation_count']).toBe(2);
    });
  });

  describe('output() format capture', () => {
    it('should capture format from string arg', async () => {
      const { images } = createMockImages();
      const instrumented = instrumentImages(images as any, 'my-images');

      const transformer = instrumented.input(new ArrayBuffer(8));
      await transformer.output('webp');

      const [, options] = mockTracer.startActiveSpan.mock.calls[0];
      expect(options.attributes['images.output.format']).toBe('webp');
    });

    it('should capture format from options object', async () => {
      const { images } = createMockImages();
      const instrumented = instrumentImages(images as any, 'my-images');

      const transformer = instrumented.input(new ArrayBuffer(8));
      await transformer.output({ format: 'avif' });

      const [, options] = mockTracer.startActiveSpan.mock.calls[0];
      expect(options.attributes['images.output.format']).toBe('avif');
    });

    it('should handle errors in output()', async () => {
      const { images, mockTransformer } = createMockImages();
      const testError = new Error('Output failed');
      mockTransformer.output = vi.fn(async () => {
        throw testError;
      });

      const instrumented = instrumentImages(images as any, 'my-images');
      const transformer = instrumented.input(new ArrayBuffer(8));

      await expect(transformer.output()).rejects.toThrow('Output failed');

      expect(mockSpan.recordException).toHaveBeenCalledWith(testError);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'Output failed',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe('this-binding', () => {
    it('should invoke info() with original object as this, not the proxy', async () => {
      let receivedThis: any;
      const mockImagesObj = {
        info: vi.fn(async function(this: any) {
          // eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
          receivedThis = this;
          return { width: 800, height: 600, format: 'png' };
        }),
        input: vi.fn(() => ({ transform: vi.fn(), draw: vi.fn(), output: vi.fn() })),
      };
      const instrumented = instrumentImages(mockImagesObj as any, 'test');
      await instrumented.info(new ArrayBuffer(8));
      expect(receivedThis).toBe(mockImagesObj);
    });

    it('should invoke input() with original object as this, not the proxy', () => {
      let receivedThis: any;
      const mockTransformer = { transform: vi.fn(), draw: vi.fn(), output: vi.fn(async () => ({})) };
      const mockImagesObj = {
        info: vi.fn(async () => ({ width: 800, height: 600, format: 'png' })),
        input: vi.fn(function(this: any) {
          // eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
          receivedThis = this;
          return mockTransformer;
        }),
      };
      const instrumented = instrumentImages(mockImagesObj as any, 'test');
      instrumented.input(new ArrayBuffer(8));
      expect(receivedThis).toBe(mockImagesObj);
    });
  });

  describe('non-instrumented methods', () => {
    it('should pass through non-instrumented methods unchanged', () => {
      const { images } = createMockImages();
      const instrumented = instrumentImages(images as any, 'my-images');

      const result = (instrumented as any).someOtherMethod();

      expect(result).toBe('passthrough');
      expect(images.someOtherMethod).toHaveBeenCalled();
      expect(mockTracer.startActiveSpan).not.toHaveBeenCalled();
    });

    it('should pass through non-instrumented properties unchanged', () => {
      const { images } = createMockImages();
      const instrumented = instrumentImages(images as any, 'my-images');

      expect((instrumented as any).someProperty).toBe('test-value');
      expect(mockTracer.startActiveSpan).not.toHaveBeenCalled();
    });
  });
});
