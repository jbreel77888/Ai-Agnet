/**
 * Email Integration — send emails via SMTP
 */
import nodemailer from 'nodemailer';

export class EmailIntegration {
  private transporter: any = null;

  constructor() {
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: parseInt(process.env.SMTP_PORT || '587') === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
    }
  }

  isAvailable(): boolean {
    return this.transporter !== null;
  }

  async send(to: string, subject: string, text: string, html?: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.transporter) {
      return { success: false, error: 'SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS.' };
    }
    try {
      const info = await this.transporter.sendMail({
        from: process.env.SMTP_USER,
        to, subject, text, html: html || text,
      });
      return { success: true, messageId: info.messageId };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
