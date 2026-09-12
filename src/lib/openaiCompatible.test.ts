import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildOpenAICompatibleChatRequest,
  parseOpenAICompatibleResponse,
  processMangaPagesOpenAICompatible,
} from './openaiCompatible';

describe('buildOpenAICompatibleChatRequest', () => {
  it('builds a well-formed OpenAI chat completions request', () => {
    const req = buildOpenAICompatibleChatRequest(
      'https://api.groq.com/openai/v1/',
      'test-key-123',
      'llama-vision',
      'Translate this page',
      'data:image/png;base64,AAAA',
      'image/png'
    );

    expect(req.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(req.headers['Authorization']).toBe('Bearer test-key-123');
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(req.body.model).toBe('llama-vision');
    expect(req.body.stream).toBe(false);
    expect(req.body.messages).toHaveLength(1);
    expect(req.body.messages[0].role).toBe('user');
    const textPart = req.body.messages[0].content.find(c => c.type === 'text');
    const imagePart = req.body.messages[0].content.find(c => c.type === 'image_url');
    expect(textPart).toEqual({ type: 'text', text: 'Translate this page' });
    expect(imagePart).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
  });

  it('strips a trailing slash from the base URL', () => {
    const req = buildOpenAICompatibleChatRequest('https://ollama.com/v1', 'k', 'm', 'p', 'BBBB', 'image/jpeg');
    expect(req.url).toBe('https://ollama.com/v1/chat/completions');
  });

  it('handles raw (non-data-URL) base64 image input', () => {
    const req = buildOpenAICompatibleChatRequest('https://api.x.ai/v1', 'k', 'grok-vision', 'p', 'CCCC', 'image/jpeg');
    const imagePart = req.body.messages[0].content.find(c => c.type === 'image_url') as any;
    expect(imagePart.image_url.url).toBe('data:image/jpeg;base64,CCCC');
  });
});

describe('parseOpenAICompatibleResponse', () => {
  it('parses a clean JSON array from choices[0].message.content', () => {
    const data = {
      choices: [
        { message: { content: '[{"type":"bubble","originalText":"a","translatedText":"b"}]' } },
      ],
    };
    const regions = parseOpenAICompatibleResponse(data);
    expect(regions).toHaveLength(1);
    expect(regions[0].originalText).toBe('a');
  });

  it('extracts JSON from a response wrapped in markdown fences/commentary', () => {
    const data = {
      choices: [
        {
          message: {
            content: 'Here is the result:\n```json\n[{"type":"sfx","originalText":"x","translatedText":"y"}]\n```',
          },
        },
      ],
    };
    const regions = parseOpenAICompatibleResponse(data);
    expect(regions).toHaveLength(1);
    expect(regions[0].type).toBe('sfx');
  });

  it('throws when there is no message content', () => {
    expect(() => parseOpenAICompatibleResponse({ choices: [] })).toThrow();
  });
});

describe('processMangaPagesOpenAICompatible', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('calls the correct URL/headers and parses a fabricated OpenAI-shaped response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify([
                {
                  type: 'bubble',
                  originalText: 'こんにちは',
                  translatedText: 'Hello',
                  ymin: 0, xmin: 0, ymax: 100, xmax: 100,
                  angle: 0, textColor: '#000', strokeColor: '#fff', strokeWidth: 1,
                  bgColor: '#fff', fontFamily: 'Arial', fontSize: 20, fontWeight: 'normal',
                  fontStyle: 'normal', textAlign: 'center', lineHeight: 1.2,
                },
              ]),
            },
          },
        ],
      }),
    });
    global.fetch = fetchMock as any;

    const results = await processMangaPagesOpenAICompatible(
      [{ id: 'p1', base64Image: 'data:image/png;base64,ZZZZ', mimeType: 'image/png' }],
      'https://openrouter.ai/api/v1',
      'my-api-key',
      'some-vision-model'
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers['Authorization']).toBe('Bearer my-api-key');

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('p1');
    expect(results[0].regions).toHaveLength(1);
    expect(results[0].regions[0].translatedText).toBe('Hello');
  });

  it('throws a descriptive error on a non-ok HTTP response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'invalid api key',
    }) as any;

    await expect(
      processMangaPagesOpenAICompatible(
        [{ id: 'p1', base64Image: 'AAAA', mimeType: 'image/png' }],
        'https://api.groq.com/openai/v1',
        'bad-key',
        'model'
      )
    ).rejects.toThrow(/401/);
  });

  it('requires baseUrl, apiKey and model', async () => {
    await expect(
      processMangaPagesOpenAICompatible([{ id: 'p1', base64Image: 'AAAA', mimeType: 'image/png' }], '', 'k', 'm')
    ).rejects.toThrow(/Base URL/);
    await expect(
      processMangaPagesOpenAICompatible([{ id: 'p1', base64Image: 'AAAA', mimeType: 'image/png' }], 'https://x', '', 'm')
    ).rejects.toThrow(/API key/);
    await expect(
      processMangaPagesOpenAICompatible([{ id: 'p1', base64Image: 'AAAA', mimeType: 'image/png' }], 'https://x', 'k', '')
    ).rejects.toThrow(/Model/);
  });
});
