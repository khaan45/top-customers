require('dotenv').config();

/**
 * Sends a real SMS. Throws if no provider is configured — this is
 * intentional so a misconfigured deployment fails loudly instead of
 * silently pretending an OTP went out.
 */
async function sendSms(mobile, message) {
  const provider = process.env.SMS_PROVIDER;

  if (provider === 'console') {
    // Dev-only: prints the message instead of sending it, so you can test
    // the whole flow before you have real SMS credentials. Never use this
    // in production — swap to a real provider before going live.
    console.log(`\n[DEV SMS to ${mobile}] ${message}\n`);
    return { dev: true };
  }

  if (provider === 'africastalking') {
    const apiKey = process.env.AT_API_KEY;
    const username = process.env.AT_USERNAME;
    const senderId = process.env.AT_SENDER_ID || '';
    if (!apiKey || !username) {
      throw new Error('SMS not configured: set AT_API_KEY and AT_USERNAME in .env');
    }
    const res = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: {
        apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        username,
        to: mobile,
        message,
        ...(senderId ? { from: senderId } : {}),
      }),
    });
    const data = await res.json();
    const recipients = data && data.SMSMessageData && data.SMSMessageData.Recipients;
    const ok = Array.isArray(recipients) && recipients.some((r) => String(r.status).toLowerCase().includes('success'));
    if (!ok) throw new Error('SMS provider rejected the message: ' + JSON.stringify(data));
    return data;
  }

  if (provider === 'generic_http') {
    const url = process.env.GENERIC_SMS_URL;
    const apiKey = process.env.GENERIC_SMS_API_KEY;
    if (!url) throw new Error('SMS not configured: set GENERIC_SMS_URL in .env');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ to: mobile, message }),
    });
    if (!res.ok) throw new Error('SMS provider returned ' + res.status);
    return await res.json().catch(() => ({}));
  }

  throw new Error(
    'No SMS provider configured. Set SMS_PROVIDER=africastalking (and AT_API_KEY/AT_USERNAME), ' +
    'SMS_PROVIDER=generic_http (and GENERIC_SMS_URL), or SMS_PROVIDER=console for local testing, in .env.'
  );
}

module.exports = { sendSms };
