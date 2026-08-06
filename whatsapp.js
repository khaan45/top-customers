require('dotenv').config();

/**
 * Sends a real OTP via WhatsApp, using Meta's WhatsApp Cloud API directly
 * (no third-party reseller needed — this is Meta's own free-tier API).
 *
 * IMPORTANT — WhatsApp's rules are different from SMS:
 * You can't just send an arbitrary text message to someone who hasn't
 * messaged you first. To send the FIRST message (which an OTP always is),
 * Meta requires using a pre-approved "Authentication" category message
 * template. You create that template once in Meta Business Manager and
 * wait for approval (usually fast, sometimes a few hours) — see the setup
 * steps in README.md. This function assumes that template already exists
 * and is named by WHATSAPP_TEMPLATE_NAME.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates
 */
async function sendWhatsAppOtp(mobileE164Digits, code) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'otp_code';
  const templateLang = process.env.WHATSAPP_TEMPLATE_LANG || 'en_US';

  if (!token || !phoneNumberId) {
    throw new Error(
      'WhatsApp not configured: set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env ' +
      '(from Meta for Developers > your app > WhatsApp > API Setup).'
    );
  }

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: mobileE164Digits, // digits only, no "+", e.g. "252634567890"
      type: 'template',
      template: {
        name: templateName,
        language: { code: templateLang },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: code }],
          },
          // Most approved OTP templates also have a "Copy code" quick-reply
          // button that needs the code passed again here. If your template
          // doesn't have that button, delete this whole object.
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: code }],
          },
        ],
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error('WhatsApp API rejected the message: ' + JSON.stringify(data));
  }
  return data;
}

module.exports = { sendWhatsAppOtp };
