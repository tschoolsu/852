import { redirect } from 'next/navigation';
import { first, sha256 } from '@/lib/cloud';

export default async function SharedPage({params}:{params:Promise<{token:string}>}) {
  const {token}=await params;
  const resource=await first<{id:string}>('SELECT id FROM resources WHERE id=?',token);
  const legacy=resource?null:await first<{resource_id:string}>('SELECT resource_id FROM share_links WHERE token_hash=?',await sha256(token));
  redirect('/?item='+encodeURIComponent(resource?.id||legacy?.resource_id||token));
}
