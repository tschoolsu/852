import { env } from 'cloudflare:workers';
import nodemailer from 'nodemailer';

export function mailConfigured() {
  return Boolean(env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM_EMAIL);
}

export async function sendMail(to:string,subject:string,text:string) {
  if(!mailConfigured()) throw new Error('MAIL_NOT_CONFIGURED');
  const host=env.SMTP_HOST || 'smtp-relay.brevo.com';
  const port=Number(env.SMTP_PORT || '465');
  // Plain SMTP is only permitted for the loopback integration-test mail server.
  const local=host==='127.0.0.1' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(env.APP_URL || '');
  const transport=nodemailer.createTransport({
    host,port,secure:port===465,requireTLS:!local&&port!==465,ignoreTLS:local,
    auth:{user:env.SMTP_USER,pass:env.SMTP_PASSWORD},
    name:'tfiles.local',connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,
    disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false,
  });
  try {
    const result=await transport.sendMail({from:{name:env.SMTP_FROM_NAME || '學生會檔案管理系統',address:env.SMTP_FROM_EMAIL!},to,subject,text});
    if(!result.accepted.length)throw new Error('MAIL_REJECTED');
  } finally {transport.close();}
}
