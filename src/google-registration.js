import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { config } from "./config.js";
import { isAllowedSchoolEmail, normalizeEmail } from "./lib/security.js";

const callbackUrl = () => `${config.appUrl}/auth/google/callback`;

export function googleRegistrationReady() {
  return Boolean(config.googleOAuth.clientId && config.googleOAuth.clientSecret);
}

function oauthClient() {
  if (!googleRegistrationReady()) throw new Error("Google OAuth 尚未設定");
  return new OAuth2Client(config.googleOAuth.clientId,config.googleOAuth.clientSecret,callbackUrl());
}

export async function createGoogleRegistrationRequest({ state,nonce }) {
  const client = oauthClient();
  const { codeVerifier,codeChallenge } = await client.generateCodeVerifierAsync();
  const url = client.generateAuthUrl({
    access_type:"online",
    response_type:"code",
    scope:["openid","email","profile"],
    state,
    nonce,
    hd:config.allowedEmailDomain,
    prompt:"select_account",
    include_granted_scopes:false,
    code_challenge:codeChallenge,
    code_challenge_method:CodeChallengeMethod.S256,
  });
  return { url,codeVerifier };
}

export async function verifyGoogleRegistration({ code,codeVerifier,nonce }) {
  const client = oauthClient();
  const { tokens } = await client.getToken({ code,codeVerifier,redirect_uri:callbackUrl() });
  if (!tokens.id_token) throw new Error("Google 未回傳身分憑證");
  const ticket = await client.verifyIdToken({ idToken:tokens.id_token,audience:config.googleOAuth.clientId });
  const profile = ticket.getPayload();
  const email = normalizeEmail(profile?.email);
  const displayName = String(profile?.name || "").trim().slice(0,80);
  if (!profile?.sub || profile.nonce !== nonce || profile.email_verified !== true
    || profile.hd?.toLowerCase() !== config.allowedEmailDomain
    || !isAllowedSchoolEmail(email,config.allowedEmailDomain) || displayName.length < 2) {
    throw new Error("Google 帳號不是可用的學校帳號，或校方帳號尚未設定本名");
  }
  return { email,displayName,googleSubject:profile.sub };
}
