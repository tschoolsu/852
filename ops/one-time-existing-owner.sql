-- Existing T-Files tables were created by postgres before the service adopted
-- Prisma Migrate. Run once as postgres, after a verified backup and before
-- the first standard deployment. No rows or columns are changed.
BEGIN;
ALTER TABLE public.users OWNER TO t_files;
ALTER TABLE public.sessions OWNER TO t_files;
ALTER TABLE public.oauth_states OWNER TO t_files;
ALTER TABLE public.resources OWNER TO t_files;
ALTER TABLE public.resource_members OWNER TO t_files;
ALTER TABLE public.share_links OWNER TO t_files;
ALTER TABLE public.resource_versions OWNER TO t_files;
ALTER TABLE public.audit_log OWNER TO t_files;
ALTER TABLE public.password_credentials OWNER TO t_files;
ALTER TABLE public.auth_tokens OWNER TO t_files;
ALTER TABLE public.auth_rate_limits OWNER TO t_files;
ALTER SEQUENCE public.audit_log_id_seq OWNER TO t_files;
COMMIT;
