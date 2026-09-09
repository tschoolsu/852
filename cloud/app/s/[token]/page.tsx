import { redirect } from 'next/navigation';

export default async function SharedPage({params}:{params:Promise<{token:string}>}) {
  const {token}=await params;
  redirect(`/?share=${encodeURIComponent(token)}`);
}
