/**
 * Brevo HTTPS delivery: used instead of SMTP when BREVO_API_KEY is set.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Brevo HTTPS delivery', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    process.env.BREVO_API_KEY = 'test-brevo-key';
    delete process.env.BREVO_SENDER_EMAIL;
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    delete process.env.BREVO_API_KEY;
    vi.unstubAllGlobals();
  });

  function jsonResponse(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, statusText: '', json: async () => body };
  }

  it('sends from the Brevo account email with the user as name and Reply-To', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { email: 'owner@example.com' }))
      .mockResolvedValueOnce(jsonResponse(201, { messageId: '<abc@smtp-relay.mailin.fr>' }));
    const { sendEmail } = await import('../mailer.js');

    const result = await sendEmail({
      to: 'friend@example.com',
      sender: { email: 'me@example.com', name: 'Me' },
      subject: 'Hi',
      html: '<p>Hello</p>',
      attachments: [{ filename: 'a.txt', contentType: 'text/plain', contentBase64: 'aGk=' }],
    });

    expect(result).toEqual({ messageId: '<abc@smtp-relay.mailin.fr>', previewUrl: null });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.brevo.com/v3/account');
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.headers['api-key']).toBe('test-brevo-key');
    expect(JSON.parse(init.body)).toMatchObject({
      sender: { email: 'owner@example.com', name: 'Me' },
      replyTo: { email: 'me@example.com', name: 'Me' },
      to: [{ email: 'friend@example.com' }],
      subject: 'Hi',
      htmlContent: '<p>Hello</p>',
      textContent: 'Hello',
      attachment: [{ name: 'a.txt', content: 'aGk=' }],
    });
  });

  it('surfaces Brevo errors so the job is retried', async () => {
    process.env.BREVO_SENDER_EMAIL = 'owner@example.com';
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { code: 'unauthorized', message: 'Key not found' }));
    const { sendEmail } = await import('../mailer.js');

    await expect(sendEmail({ to: 'friend@example.com', subject: 'Hi', html: 'x' })).rejects.toThrow(
      'Brevo API 401: Key not found'
    );
  });
});
