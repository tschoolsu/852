import { appOrigin } from '@/lib/cloud';
// Legacy bookmarks redirect to independent authentication; no OAuth exchange occurs.
export async function GET(request:Request){return Response.redirect(new URL('/',appOrigin(request)),302);}
