import { first, sha256 } from './cloud';

export async function allowAction(action:string,identity:string,limit:number,seconds:number,cost=1) {
  const timestamp=Date.now(),expires=timestamp+seconds*1000;
  const key=await sha256(`${action}:${identity}`);
  const row=await first<{hits:number}>(`INSERT INTO auth_rate_limits(key,hits,expires_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN auth_rate_limits.expires_at<=? THEN excluded.hits ELSE auth_rate_limits.hits+excluded.hits END,
    expires_at=CASE WHEN auth_rate_limits.expires_at<=? THEN excluded.expires_at ELSE auth_rate_limits.expires_at END
    RETURNING hits`,key,cost,expires,timestamp,timestamp);
  return Boolean(row&&row.hits<=limit);
}
