-- Create verification_tokens table for passwordless authentication staging
CREATE TABLE public.verification_tokens (
    identifier character varying(255) NOT NULL,
    token character varying(255) NOT NULL,
    expires timestamp with time zone NOT NULL,
    PRIMARY KEY (identifier, token)
);

-- Index for pruning expired tokens
CREATE INDEX idx_verification_tokens_expires ON public.verification_tokens(expires);

-- Enable RLS (Row Level Security) - backend accesses this table using service_role,
-- so we do not need to create any public policies.
ALTER TABLE public.verification_tokens ENABLE ROW LEVEL SECURITY;
