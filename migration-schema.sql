--
-- PostgreSQL database dump
--

\restrict gYntmaNvlUnHEruDNqMgx1yXtozQtJZdsNYnrhMalkmANLYJZxG7e2m7RZ4qa40

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgboss; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA pgboss;


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: job_state; Type: TYPE; Schema: pgboss; Owner: -
--

CREATE TYPE pgboss.job_state AS ENUM (
    'created',
    'retry',
    'active',
    'completed',
    'cancelled',
    'failed'
);


--
-- Name: create_queue(text, json); Type: FUNCTION; Schema: pgboss; Owner: -
--

CREATE FUNCTION pgboss.create_queue(queue_name text, options json) RETURNS void
    LANGUAGE plpgsql
    AS $_$
    DECLARE
      table_name varchar := 'j' || encode(sha224(queue_name::bytea), 'hex');
      queue_created_on timestamptz;
    BEGIN

      WITH q as (
      INSERT INTO pgboss.queue (
        name,
        policy,
        retry_limit,
        retry_delay,
        retry_backoff,
        expire_seconds,
        retention_minutes,
        dead_letter,
        partition_name
      )
      VALUES (
        queue_name,
        options->>'policy',
        (options->>'retryLimit')::int,
        (options->>'retryDelay')::int,
        (options->>'retryBackoff')::bool,
        (options->>'expireInSeconds')::int,
        (options->>'retentionMinutes')::int,
        options->>'deadLetter',
        table_name
      )
      ON CONFLICT DO NOTHING
      RETURNING created_on
      )
      SELECT created_on into queue_created_on from q;

      IF queue_created_on IS NULL THEN
        RETURN;
      END IF;

      EXECUTE format('CREATE TABLE pgboss.%I (LIKE pgboss.job INCLUDING DEFAULTS)', table_name);

      EXECUTE format('ALTER TABLE pgboss.%1$I ADD PRIMARY KEY (name, id)', table_name);
      EXECUTE format('ALTER TABLE pgboss.%1$I ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED', table_name);
      EXECUTE format('ALTER TABLE pgboss.%1$I ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED', table_name);
      EXECUTE format('CREATE UNIQUE INDEX %1$s_i1 ON pgboss.%1$I (name, COALESCE(singleton_key, '''')) WHERE state = ''created'' AND policy = ''short''', table_name);
      EXECUTE format('CREATE UNIQUE INDEX %1$s_i2 ON pgboss.%1$I (name, COALESCE(singleton_key, '''')) WHERE state = ''active'' AND policy = ''singleton''', table_name);
      EXECUTE format('CREATE UNIQUE INDEX %1$s_i3 ON pgboss.%1$I (name, state, COALESCE(singleton_key, '''')) WHERE state <= ''active'' AND policy = ''stately''', table_name);
      EXECUTE format('CREATE UNIQUE INDEX %1$s_i4 ON pgboss.%1$I (name, singleton_on, COALESCE(singleton_key, '''')) WHERE state <> ''cancelled'' AND singleton_on IS NOT NULL', table_name);
      EXECUTE format('CREATE INDEX %1$s_i5 ON pgboss.%1$I (name, start_after) INCLUDE (priority, created_on, id) WHERE state < ''active''', table_name);

      EXECUTE format('ALTER TABLE pgboss.%I ADD CONSTRAINT cjc CHECK (name=%L)', table_name, queue_name);
      EXECUTE format('ALTER TABLE pgboss.job ATTACH PARTITION pgboss.%I FOR VALUES IN (%L)', table_name, queue_name);
    END;
    $_$;


--
-- Name: delete_queue(text); Type: FUNCTION; Schema: pgboss; Owner: -
--

CREATE FUNCTION pgboss.delete_queue(queue_name text) RETURNS void
    LANGUAGE plpgsql
    AS $$
    DECLARE
      table_name varchar;
    BEGIN
      WITH deleted as (
        DELETE FROM pgboss.queue
        WHERE name = queue_name
        RETURNING partition_name
      )
      SELECT partition_name from deleted INTO table_name;

      EXECUTE format('DROP TABLE IF EXISTS pgboss.%I', table_name);
    END;
    $$;


--
-- Name: assert_login_email_unused(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_login_email_unused() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  -- Serialize on the address itself before looking. Two transactions
  -- inserting the same address into the two different tables would otherwise
  -- each see no committed conflict and both commit, leaving one address that
  -- signs in to two accounts. Taking the lock first makes the check mean
  -- something under concurrency; it is released with the transaction.
  perform pg_advisory_xact_lock(hashtext(lower(new.email)));

  if tg_table_name = 'users' then
    if exists (
      select 1 from user_email_aliases a where lower(a.email) = lower(new.email)
    ) then
      raise exception 'Email % is already a login alias', new.email
        using errcode = '23505';
    end if;
  else
    if exists (
      select 1 from users u where lower(u.email) = lower(new.email)
    ) then
      raise exception 'Email % is already a user account', new.email
        using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: assigned_to_must_be_member(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assigned_to_must_be_member() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.assigned_to is null then
    -- Unassigning is always allowed, and clears the trail with it.
    new.assigned_at := null;
    new.assigned_by := null;
    return new;
  end if;
  if not exists (
    select 1 from organization_members m
     where m.org_id = new.org_id and m.user_id = new.assigned_to
  ) then
    raise exception 'assigned_to must be a member of the record''s organization';
  end if;
  if new.assigned_by is not null and not exists (
    select 1 from organization_members m
     where m.org_id = new.org_id and m.user_id = new.assigned_by
  ) then
    raise exception 'assigned_by must be a member of the record''s organization';
  end if;
  if new.assigned_at is null then new.assigned_at := now(); end if;
  return new;
end;
$$;


--
-- Name: bid_calculation_snapshots_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bid_calculation_snapshots_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'bid_calculation_snapshots rows are immutable';
  end if;
  -- A snapshot goes when its bid goes, and not otherwise. During a cascade the
  -- parent row is already deleted by the time this fires, which is what
  -- distinguishes "the bid was removed" from "somebody removed the evidence".
  if tg_op = 'DELETE' and exists (select 1 from bids where id = old.bid_id) then
    raise exception 'bid_calculation_snapshots rows cannot be deleted while the bid exists';
  end if;
  return old;
end;
$$;


--
-- Name: compliance_event_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compliance_event_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from compliance_items where id = old.item_id) then
      raise exception 'compliance_item_events rows cannot be deleted while the item exists';
    end if;
    return old;
  end if;
  raise exception 'compliance_item_events rows cannot be changed once written';
end $$;


--
-- Name: derive_org_for_agent_log(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.derive_org_for_agent_log() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.org_id is null and new.opportunity_id is not null then
    select org_id into new.org_id from opportunities where id = new.opportunity_id;
  end if;
  if new.org_id is null and new.subcontractor_id is not null then
    select org_id into new.org_id from subcontractors where id = new.subcontractor_id;
  end if;
  if new.org_id is null and new.bid_id is not null then
    select org_id into new.org_id from bids where id = new.bid_id;
  end if;
  return new;
end;
$$;


--
-- Name: derive_org_for_communication(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.derive_org_for_communication() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.org_id is null and new.opportunity_id is not null then
    select org_id into new.org_id from opportunities where id = new.opportunity_id;
  end if;
  if new.org_id is null and new.subcontractor_id is not null then
    select org_id into new.org_id from subcontractors where id = new.subcontractor_id;
  end if;
  return new;
end;
$$;


--
-- Name: derive_org_from_opportunity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.derive_org_from_opportunity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.org_id is null and new.opportunity_id is not null then
    select org_id into new.org_id from opportunities where id = new.opportunity_id;
  end if;
  return new;
end;
$$;


--
-- Name: derive_org_from_subcontractor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.derive_org_from_subcontractor() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.org_id is null and new.subcontractor_id is not null then
    select org_id into new.org_id from subcontractors where id = new.subcontractor_id;
  end if;
  return new;
end;
$$;


--
-- Name: requirement_state_events_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.requirement_state_events_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'requirement_state_events rows cannot be changed once written';
  end if;
  if tg_op = 'DELETE' and exists (select 1 from opportunities where id = old.opportunity_id) then
    raise exception 'requirement_state_events rows cannot be deleted while the opportunity exists';
  end if;
  return old;
end;
$$;


--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin new.updated_at = now(); return new; end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: archive; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.archive (
    id uuid NOT NULL,
    name text NOT NULL,
    priority integer NOT NULL,
    data jsonb,
    state pgboss.job_state NOT NULL,
    retry_limit integer NOT NULL,
    retry_count integer NOT NULL,
    retry_delay integer NOT NULL,
    retry_backoff boolean NOT NULL,
    start_after timestamp with time zone NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval NOT NULL,
    created_on timestamp with time zone NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    archived_on timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: job; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.job (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text
)
PARTITION BY LIST (name);


--
-- Name: j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'compliance-monitor'::text))
);


--
-- Name: j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'account-deletion-sweep'::text))
);


--
-- Name: j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'analytics-engine'::text))
);


--
-- Name: j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'reply-poll'::text))
);


--
-- Name: j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'trial-sweep'::text))
);


--
-- Name: j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'scoring-engine'::text))
);


--
-- Name: j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'outreach'::text))
);


--
-- Name: j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'sub-finder'::text))
);


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = '__pgboss__send-it'::text))
);


--
-- Name: j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'sub-verify'::text))
);


--
-- Name: j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'contact-recheck-sweep'::text))
);


--
-- Name: j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'sources-sought-responder'::text))
);


--
-- Name: j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'scoring-recovery-sweep'::text))
);


--
-- Name: j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'daily-recap'::text))
);


--
-- Name: j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'log-retention-sweep'::text))
);


--
-- Name: j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'deadline-monitor'::text))
);


--
-- Name: ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'review-expiry-sweep'::text))
);


--
-- Name: jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'backlink-scout'::text))
);


--
-- Name: jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'outreach-recovery-sweep'::text))
);


--
-- Name: jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'pricing-research'::text))
);


--
-- Name: jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'learning-loop'::text))
);


--
-- Name: jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'call-prep'::text))
);


--
-- Name: jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'reverify'::text))
);


--
-- Name: jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'unresponsive-sweep'::text))
);


--
-- Name: jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'opportunity-monitor'::text))
);


--
-- Name: jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'compliance-auditor'::text))
);


--
-- Name: jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'expired-opportunity-sweep'::text))
);


--
-- Name: jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'backlink-outreach-sweep'::text))
);


--
-- Name: je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'stalled-pipeline-sweep'::text))
);


--
-- Name: je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'sub-onboarding'::text))
);


--
-- Name: jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'retention-sweep'::text))
);


--
-- Name: jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'concession-sweep'::text))
);


--
-- Name: jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'outreach-followup'::text))
);


--
-- Name: jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'solicitation-analyst'::text))
);


--
-- Name: jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'compliance-sweep'::text))
);


--
-- Name: jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'bid-builder'::text))
);


--
-- Name: queue; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.queue (
    name text NOT NULL,
    policy text,
    retry_limit integer,
    retry_delay integer,
    retry_backoff boolean,
    expire_seconds integer,
    retention_minutes integer,
    dead_letter text,
    partition_name text,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    updated_on timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schedule; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.schedule (
    name text NOT NULL,
    cron text NOT NULL,
    timezone text,
    data jsonb,
    options jsonb,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    updated_on timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscription; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.subscription (
    event text NOT NULL,
    name text NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    updated_on timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: version; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.version (
    version integer NOT NULL,
    maintained_on timestamp with time zone,
    cron_on timestamp with time zone,
    monitored_on timestamp with time zone
);


--
-- Name: _migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._migrations (
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    checksum text
);


--
-- Name: account_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    invited_by_email text NOT NULL,
    invited_by_user_id uuid,
    plan_key text NOT NULL,
    billing_interval text NOT NULL,
    concession_kind text NOT NULL,
    concession_percent integer,
    concession_months integer,
    concession_code text,
    stripe_coupon_id text,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    note text,
    accepted_at timestamp with time zone,
    accepted_user_id uuid,
    accepted_org_id uuid,
    revoked_at timestamp with time zone,
    revoked_by text,
    sent_count integer DEFAULT 1 NOT NULL,
    last_sent_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    terms_applied_at timestamp with time zone,
    CONSTRAINT account_invitations_kind_ck CHECK ((concession_kind = ANY (ARRAY['none'::text, 'percent'::text, 'free_months'::text, 'free_account'::text]))),
    CONSTRAINT account_invitations_shape_ck CHECK (
CASE concession_kind
    WHEN 'percent'::text THEN (((concession_percent >= 1) AND (concession_percent <= 100)) AND ((concession_months IS NULL) OR ((concession_months >= 1) AND (concession_months <= 36))))
    WHEN 'free_months'::text THEN (((concession_months >= 1) AND (concession_months <= 36)) AND (concession_percent IS NULL))
    ELSE ((concession_percent IS NULL) AND (concession_months IS NULL))
END)
);


--
-- Name: COLUMN account_invitations.concession_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.account_invitations.concession_code IS 'Our own short reference for this grant, e.g. BROST-K4M9. Not redeemable: it is a label for humans reading audit entries, not a Stripe promotion code.';


--
-- Name: COLUMN account_invitations.stripe_coupon_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.account_invitations.stripe_coupon_id IS 'The Stripe coupon behind the discount. Attached server-side at checkout; never handed to the customer.';


--
-- Name: COLUMN account_invitations.accepted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.account_invitations.accepted_at IS 'Claimed atomically at redemption. Set before the account is created so two simultaneous requests cannot both use the link; cleared again if account creation then fails.';


--
-- Name: COLUMN account_invitations.terms_applied_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.account_invitations.terms_applied_at IS 'Set once the promised plan and concession are written to the accepted organization. Accepted with this still null means the account exists on standard terms and needs the concession applying by hand.';


--
-- Name: admin_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_email text NOT NULL,
    action text NOT NULL,
    target_org_id uuid,
    target_org_name text,
    target_user_id uuid,
    detail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent text NOT NULL,
    action text NOT NULL,
    opportunity_id uuid,
    subcontractor_id uuid,
    bid_id uuid,
    level text DEFAULT 'info'::text NOT NULL,
    status text DEFAULT 'ok'::text NOT NULL,
    message text,
    reasoning text,
    input_json jsonb,
    output_json jsonb,
    duration_ms integer,
    claude_usage jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid
);


--
-- Name: analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid,
    user_id uuid,
    event text NOT NULL,
    path text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value_json jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text,
    org_id uuid
);


--
-- Name: authority_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.authority_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    domain_rating numeric,
    referring_domains integer,
    backlinks_total integer,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid
);


--
-- Name: automation_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_incidents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    state text DEFAULT 'detected'::text NOT NULL,
    cause text NOT NULL,
    severity text DEFAULT 'blocking'::text NOT NULL,
    provider text,
    integration text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    detection_source text DEFAULT 'job_failure'::text NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    requeued_count integer DEFAULT 0 NOT NULL,
    completed_count integer DEFAULT 0 NOT NULL,
    remaining_count integer DEFAULT 0 NOT NULL,
    last_provider_success_at timestamp with time zone,
    last_agent_success_at timestamp with time zone,
    next_run_at timestamp with time zone,
    recommended_action text,
    repair_attempts integer DEFAULT 0 NOT NULL,
    recovery_owner text,
    test_ran_at timestamp with time zone,
    test_passed boolean,
    test_detail text,
    recovered_at timestamp with time zone,
    recovery_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT automation_incidents_recovered_ck CHECK (((state <> 'recovered'::text) OR (recovered_at IS NOT NULL))),
    CONSTRAINT automation_incidents_severity_ck CHECK ((severity = ANY (ARRAY['blocking'::text, 'degrading'::text]))),
    CONSTRAINT automation_incidents_state_ck CHECK ((state = ANY (ARRAY['detected'::text, 'mitigating'::text, 'provider_restored'::text, 'test_passed'::text, 'backlog_requeued'::text, 'backlog_draining'::text, 'recovered'::text, 'recovery_failed'::text])))
);


--
-- Name: backlink_competitors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backlink_competitors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    domain text NOT NULL,
    source text DEFAULT 'ahrefs_auto'::text NOT NULL,
    domain_rating numeric,
    last_scanned_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid
);


--
-- Name: backlink_outreach; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backlink_outreach (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    channel text DEFAULT 'email'::text NOT NULL,
    subject text,
    body text,
    approval_status text DEFAULT 'pending'::text NOT NULL,
    sent_at timestamp with time zone,
    replied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    gmail_message_id text,
    gmail_thread_id text,
    tracking_id text,
    follow_up_at timestamp with time zone,
    follow_up_sent boolean DEFAULT false NOT NULL,
    send_error text,
    org_id uuid
);


--
-- Name: backlink_prospects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backlink_prospects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    domain text NOT NULL,
    url text,
    opportunity_type text NOT NULL,
    domain_rating numeric,
    relevance numeric,
    traffic bigint,
    spam_score numeric,
    indexed boolean,
    link_type text,
    priority_score numeric,
    tier text,
    qualification_json jsonb,
    contact_email text,
    contact_json jsonb,
    discovered_via text,
    competitor_id uuid,
    status text DEFAULT 'new'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid
);


--
-- Name: backlinks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backlinks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_domain text NOT NULL,
    source_url text,
    target_url text,
    anchor text,
    domain_rating numeric,
    link_type text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    lost_at timestamp with time zone,
    prospect_id uuid,
    raw_json jsonb,
    org_id uuid
);


--
-- Name: bid_calculation_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bid_calculation_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bid_id uuid NOT NULL,
    org_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    reason text NOT NULL,
    taken_at timestamp with time zone DEFAULT now() NOT NULL,
    actor text NOT NULL,
    calculation jsonb NOT NULL,
    calculation_hash text NOT NULL,
    CONSTRAINT bid_calc_snapshot_reason_ck CHECK ((reason = ANY (ARRAY['approved'::text, 'sent'::text])))
);


--
-- Name: bid_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bid_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bid_id uuid NOT NULL,
    org_id uuid NOT NULL,
    requirement text NOT NULL,
    reason text NOT NULL,
    risk text DEFAULT 'serious'::text NOT NULL,
    actor text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    approved_by text,
    approved_at timestamp with time zone,
    CONSTRAINT bid_overrides_reason_ck CHECK ((length(btrim(reason)) >= 20)),
    CONSTRAINT bid_overrides_risk_ck CHECK ((risk = ANY (ARRAY['notable'::text, 'serious'::text])))
);


--
-- Name: bid_submission_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bid_submission_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bid_id uuid NOT NULL,
    org_id uuid NOT NULL,
    from_state text,
    to_state text NOT NULL,
    actor text NOT NULL,
    proof text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bids; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bids (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    opportunity_id uuid NOT NULL,
    sub_quote_total numeric,
    markup_pct numeric,
    bid_amount numeric,
    margin_pct numeric,
    target_margin_pct numeric,
    qa_checklist jsonb,
    narrative text,
    documents_json jsonb DEFAULT '[]'::jsonb,
    human_flags text[] DEFAULT '{}'::text[],
    submitted_at timestamp with time zone,
    outcome text,
    award_amount numeric,
    loss_reason text,
    cpars_rating text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    compliance_matrix jsonb,
    package_manifest jsonb,
    package_ready boolean DEFAULT false NOT NULL,
    validation_json jsonb,
    audit_findings jsonb,
    audit_status text,
    org_id uuid,
    requirements_fingerprint text,
    audit_ran_at timestamp with time zone,
    submission_state text DEFAULT 'package_ready'::text NOT NULL,
    submission_method text,
    submission_destination text,
    sent_timezone text,
    confirmation_number text,
    proof_document_id uuid,
    submission_attestation text,
    submitted_by text,
    submitted_package_hash text,
    receipt_confirmed_at timestamp with time zone,
    receipt_detail text,
    rejected_reason text,
    withdrawn_reason text,
    provider_request_id text,
    provider_response text,
    CONSTRAINT bids_rejected_reason_ck CHECK (((submission_state <> 'rejected'::text) OR (COALESCE(btrim(rejected_reason), ''::text) <> ''::text))),
    CONSTRAINT bids_submission_state_ck CHECK ((submission_state = ANY (ARRAY['package_ready'::text, 'approved'::text, 'sending'::text, 'sent'::text, 'receipt_confirmed'::text, 'accepted'::text, 'rejected'::text, 'withdrawn'::text, 'failed'::text]))),
    CONSTRAINT bids_submitted_evidence_ck CHECK (((submitted_at IS NULL) OR ((submission_method IS NOT NULL) AND (COALESCE(btrim(submission_destination), ''::text) <> ''::text) AND (sent_timezone IS NOT NULL))))
);


--
-- Name: COLUMN bids.sub_quote_total; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bids.sub_quote_total IS 'Sum of sub quotes in whole US dollars (not cents).';


--
-- Name: COLUMN bids.bid_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bids.bid_amount IS 'Bid price in whole US dollars (not cents).';


--
-- Name: COLUMN bids.award_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bids.award_amount IS 'Award amount in whole US dollars (not cents).';


--
-- Name: COLUMN bids.compliance_matrix; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bids.compliance_matrix IS 'Every solicitation submission requirement, resolved to satisfied/needs_signature/needs_operator/missing.';


--
-- Name: COLUMN bids.package_manifest; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bids.package_manifest IS 'Ordered, correctly-named files that make up the submission package.';


--
-- Name: COLUMN bids.package_ready; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bids.package_ready IS 'True when pre-submission validation found no blockers.';


--
-- Name: COLUMN bids.audit_findings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bids.audit_findings IS 'Independent compliance-auditor findings (missing/non-compliant items).';


--
-- Name: COLUMN bids.audit_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bids.audit_status IS 'pending | clean | issues | skipped.';


--
-- Name: billing_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    stripe_invoice_id text NOT NULL,
    number text,
    status text NOT NULL,
    amount_due_cents integer,
    amount_paid_cents integer,
    currency text,
    period_start timestamp with time zone,
    period_end timestamp with time zone,
    hosted_invoice_url text,
    invoice_pdf_url text,
    issued_at timestamp with time zone,
    paid_at timestamp with time zone,
    failure_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: call_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_cards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    opportunity_id uuid NOT NULL,
    subcontractor_id uuid NOT NULL,
    card_json jsonb NOT NULL,
    call_script text,
    question_list jsonb,
    needs_project_history boolean DEFAULT false NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    called_at timestamp with time zone,
    response_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    quote_amount numeric,
    source text DEFAULT 'reply'::text NOT NULL,
    snoozed_until timestamp with time zone,
    org_id uuid,
    skip_reason text,
    skip_note text,
    skip_scope text,
    skipped_by text,
    dialed boolean DEFAULT false NOT NULL
);


--
-- Name: commission_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    influencer_id uuid NOT NULL,
    attribution_id uuid NOT NULL,
    org_id uuid,
    kind text NOT NULL,
    stripe_invoice_id text,
    stripe_charge_id text,
    stripe_refund_id text,
    gross_amount_cents integer NOT NULL,
    commission_percent numeric(5,2) NOT NULL,
    amount_cents integer NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    payout_id uuid,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: communications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subcontractor_id uuid,
    opportunity_id uuid,
    channel text NOT NULL,
    direction text NOT NULL,
    subject text,
    body text,
    gmail_message_id text,
    gmail_thread_id text,
    tracking_id text,
    opened_at timestamp with time zone,
    clicked_at timestamp with time zone,
    replied_at timestamp with time zone,
    follow_up_at timestamp with time zone,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    provider text,
    recipient_email text,
    org_id uuid,
    rfc822_message_id text,
    delivery_state text DEFAULT 'sent'::text NOT NULL,
    delivery_detail text,
    delivery_updated_at timestamp with time zone,
    CONSTRAINT communications_delivery_state_check CHECK ((delivery_state = ANY (ARRAY['sent'::text, 'delivered'::text, 'bounced'::text, 'deferred'::text, 'failed'::text])))
);


--
-- Name: company_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_profile (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    profile_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    profile_text text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text,
    org_id uuid
);


--
-- Name: compliance_item_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_item_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    item_id uuid NOT NULL,
    storage_path text NOT NULL,
    original_filename text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint,
    kind text,
    note text,
    uploaded_by uuid,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    superseded_by uuid,
    CONSTRAINT compliance_item_documents_name_ck CHECK ((length(btrim(original_filename)) > 0)),
    CONSTRAINT compliance_item_documents_not_self_ck CHECK (((superseded_by IS NULL) OR (superseded_by <> id))),
    CONSTRAINT compliance_item_documents_path_ck CHECK ((length(btrim(storage_path)) > 0))
);


--
-- Name: compliance_item_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_item_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    item_id uuid NOT NULL,
    kind text NOT NULL,
    summary text NOT NULL,
    changes jsonb DEFAULT '{}'::jsonb NOT NULL,
    actor_id uuid,
    actor_label text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT compliance_item_events_kind_ck CHECK ((kind = ANY (ARRAY['created'::text, 'edited'::text, 'verified'::text, 'state_changed'::text, 'document'::text, 'renewed'::text, 'escalated'::text, 'note'::text]))),
    CONSTRAINT compliance_item_events_summary_ck CHECK ((length(btrim(summary)) > 0))
);


--
-- Name: compliance_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    label text NOT NULL,
    contract_id uuid,
    due_at timestamp with time zone,
    status text DEFAULT 'incomplete'::text NOT NULL,
    days_remaining integer,
    detail jsonb,
    last_checked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    link_url text,
    doc_url text,
    due_at_override timestamp with time zone,
    status_override text,
    source text DEFAULT 'monitor'::text NOT NULL,
    org_id uuid,
    assigned_to uuid,
    assigned_at timestamp with time zone,
    assigned_by uuid,
    time_zone text,
    recurrence text,
    recurrence_months integer,
    window_days integer,
    escalate_after_days integer,
    escalate_to text,
    verified_at timestamp with time zone,
    verified_by uuid,
    conflict_detail text,
    needs_review_reason text,
    blocked_by text,
    monitorable boolean DEFAULT true NOT NULL,
    required boolean DEFAULT true NOT NULL,
    satisfied_at timestamp with time zone,
    doc_url_note text,
    CONSTRAINT compliance_items_recurrence_ck CHECK (((recurrence IS NULL) OR ((recurrence = ANY (ARRAY['annual'::text, 'semiannual'::text, 'quarterly'::text, 'monthly'::text, 'custom'::text])) AND ((recurrence <> 'custom'::text) OR (recurrence_months > 0))))),
    CONSTRAINT compliance_items_status_ck CHECK ((status = ANY (ARRAY['conflicting'::text, 'expired'::text, 'blocked'::text, 'needs_review'::text, 'expiring_soon'::text, 'cannot_monitor'::text, 'incomplete'::text, 'complete'::text]))),
    CONSTRAINT compliance_items_status_override_ck CHECK (((status_override IS NULL) OR (status_override = ANY (ARRAY['conflicting'::text, 'expired'::text, 'blocked'::text, 'needs_review'::text, 'expiring_soon'::text, 'cannot_monitor'::text, 'incomplete'::text, 'complete'::text])))),
    CONSTRAINT compliance_items_windows_ck CHECK ((((window_days IS NULL) OR (window_days > 0)) AND ((escalate_after_days IS NULL) OR (escalate_after_days > 0)) AND ((recurrence_months IS NULL) OR (recurrence_months > 0))))
);


--
-- Name: content_library; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_library (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    category text DEFAULT 'past_performance'::text NOT NULL,
    body text NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid
);


--
-- Name: contract_coordination; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_coordination (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    contract_id uuid NOT NULL,
    happened_at timestamp with time zone DEFAULT now() NOT NULL,
    channel text NOT NULL,
    with_whom text NOT NULL,
    subcontractor_id uuid,
    summary text NOT NULL,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contract_coordination_channel_ck CHECK ((channel = ANY (ARRAY['call'::text, 'email'::text, 'meeting'::text, 'site_visit'::text, 'other'::text]))),
    CONSTRAINT contract_coordination_summary_ck CHECK ((length(btrim(summary)) > 0)),
    CONSTRAINT contract_coordination_with_ck CHECK ((length(btrim(with_whom)) > 0))
);


--
-- Name: contract_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    contract_id uuid NOT NULL,
    invoice_number text NOT NULL,
    amount_cents bigint NOT NULL,
    period_start date,
    period_end date,
    submitted_at timestamp with time zone,
    paid_at timestamp with time zone,
    paid_cents bigint,
    rejected_at timestamp with time zone,
    rejected_reason text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contract_invoices_amount_ck CHECK ((amount_cents >= 0)),
    CONSTRAINT contract_invoices_number_ck CHECK ((length(btrim(invoice_number)) > 0)),
    CONSTRAINT contract_invoices_paid_ck CHECK (((paid_at IS NULL) OR ((paid_cents IS NOT NULL) AND (paid_cents >= 0)))),
    CONSTRAINT contract_invoices_rejected_ck CHECK (((rejected_at IS NULL) OR (length(btrim(COALESCE(rejected_reason, ''::text))) > 0))),
    CONSTRAINT contract_invoices_state_ck CHECK (((paid_at IS NULL) OR (rejected_at IS NULL)))
);


--
-- Name: contract_issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_issues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    contract_id uuid NOT NULL,
    title text NOT NULL,
    detail text,
    severity text DEFAULT 'normal'::text NOT NULL,
    raised_at timestamp with time zone DEFAULT now() NOT NULL,
    raised_by uuid,
    resolved_at timestamp with time zone,
    resolution text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contract_issues_resolution_ck CHECK (((resolved_at IS NULL) OR (length(btrim(COALESCE(resolution, ''::text))) > 0))),
    CONSTRAINT contract_issues_severity_ck CHECK ((severity = ANY (ARRAY['normal'::text, 'serious'::text, 'blocking'::text]))),
    CONSTRAINT contract_issues_title_ck CHECK ((length(btrim(title)) > 0))
);


--
-- Name: contract_milestones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_milestones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    contract_id uuid NOT NULL,
    kind text DEFAULT 'milestone'::text NOT NULL,
    name text NOT NULL,
    detail text,
    due_at date,
    completed_at timestamp with time zone,
    completed_by uuid,
    amount_cents bigint,
    evidence_note text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contract_milestones_amount_ck CHECK (((amount_cents IS NULL) OR (amount_cents >= 0))),
    CONSTRAINT contract_milestones_kind_ck CHECK ((kind = ANY (ARRAY['milestone'::text, 'deliverable'::text]))),
    CONSTRAINT contract_milestones_name_ck CHECK ((length(btrim(name)) > 0))
);


--
-- Name: contract_modifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_modifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    contract_id uuid NOT NULL,
    mod_number text NOT NULL,
    kind text NOT NULL,
    summary text NOT NULL,
    value_delta_cents bigint,
    new_end_date date,
    effective_at date,
    source_document text,
    source_note text,
    superseded_by uuid,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contract_modifications_kind_ck CHECK ((kind = ANY (ARRAY['scope'::text, 'value'::text, 'schedule'::text, 'administrative'::text, 'termination'::text]))),
    CONSTRAINT contract_modifications_not_self_ck CHECK (((superseded_by IS NULL) OR (superseded_by <> id))),
    CONSTRAINT contract_modifications_number_ck CHECK ((length(btrim(mod_number)) > 0)),
    CONSTRAINT contract_modifications_summary_ck CHECK ((length(btrim(summary)) > 0))
);


--
-- Name: contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contracts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bid_id uuid,
    opportunity_id uuid,
    contract_number text,
    award_amount numeric,
    start_date date,
    end_date date,
    milestones jsonb DEFAULT '[]'::jsonb,
    primary_sub_id uuid,
    backup_sub_id uuid,
    coordination_log jsonb DEFAULT '[]'::jsonb,
    non_ss_sub_pct numeric DEFAULT 0 NOT NULL,
    co_contact_json jsonb,
    cpars_due_at timestamp with time zone,
    cpars_status text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid,
    assigned_to uuid,
    assigned_at timestamp with time zone,
    assigned_by uuid,
    closeout_started_at timestamp with time zone,
    closeout_completed_at timestamp with time zone,
    closeout_notes text,
    retainage_pct numeric,
    insurance_required text,
    bond_required_cents bigint,
    created_manually boolean DEFAULT false NOT NULL,
    created_by uuid,
    CONSTRAINT contracts_closeout_order_ck CHECK (((closeout_completed_at IS NULL) OR ((closeout_started_at IS NOT NULL) AND (closeout_completed_at >= closeout_started_at)))),
    CONSTRAINT contracts_non_ss_sub_pct_range CHECK (((non_ss_sub_pct >= (0)::numeric) AND (non_ss_sub_pct <= (100)::numeric))),
    CONSTRAINT contracts_retainage_ck CHECK (((retainage_pct IS NULL) OR ((retainage_pct >= (0)::numeric) AND (retainage_pct <= (100)::numeric))))
);


--
-- Name: COLUMN contracts.award_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contracts.award_amount IS 'Contract award amount in whole US dollars (not cents).';


--
-- Name: COLUMN contracts.backup_sub_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contracts.backup_sub_id IS 'Backup subcontractor (recommended; nullable because a contract can be recorded before the backup is confirmed).';


--
-- Name: conversation_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_flags (
    org_id uuid NOT NULL,
    thread_key text NOT NULL,
    read_at timestamp with time zone,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: custom_kpis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_kpis (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text NOT NULL,
    metric text NOT NULL,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    opportunity_id uuid,
    bid_id uuid,
    kind text NOT NULL,
    name text NOT NULL,
    storage_path text,
    storage_backend text DEFAULT 'supabase'::text NOT NULL,
    mime text,
    version integer DEFAULT 1 NOT NULL,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid,
    requirement_id text,
    source_system text,
    source_url text,
    original_filename text,
    content_hash text,
    byte_size bigint,
    page_count integer,
    document_class text,
    amendment_number integer,
    superseded_by uuid,
    disposition text DEFAULT 'blocked'::text NOT NULL,
    excluded_reason text,
    excluded_by text,
    excluded_at timestamp with time zone,
    extraction_state text DEFAULT 'pending'::text NOT NULL,
    ocr_state text,
    access_state text,
    extraction_model text,
    extraction_version integer,
    extracted_at timestamp with time zone,
    received_at timestamp with time zone,
    last_verified_at timestamp with time zone,
    trade_relevance jsonb,
    relevant_to_all boolean,
    last_error text,
    retry_count integer DEFAULT 0 NOT NULL,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    review_note text,
    CONSTRAINT documents_disposition_ck CHECK ((disposition = ANY (ARRAY['delivered'::text, 'delivered_via_link'::text, 'excluded'::text, 'blocked'::text]))),
    CONSTRAINT documents_excluded_reason_ck CHECK (((disposition <> 'excluded'::text) OR (COALESCE(btrim(excluded_reason), ''::text) <> ''::text))),
    CONSTRAINT documents_extraction_state_ck CHECK ((extraction_state = ANY (ARRAY['pending'::text, 'extracted'::text, 'partial'::text, 'not_read'::text, 'unreadable'::text, 'not_applicable'::text])))
);


--
-- Name: email_suppressions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_suppressions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    email text NOT NULL,
    reason text,
    source text DEFAULT 'operator'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: feedback_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid,
    user_email text,
    category text NOT NULL,
    message text NOT NULL,
    page text,
    browser text,
    diagnostics jsonb,
    diagnostics_consented boolean DEFAULT false NOT NULL,
    storage_path text,
    screenshot_name text,
    status text DEFAULT 'new'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT feedback_reports_category_ck CHECK ((category = ANY (ARRAY['bug'::text, 'wrong_number'::text, 'confusing'::text, 'feature'::text, 'other'::text]))),
    CONSTRAINT feedback_reports_consent_ck CHECK (((diagnostics IS NULL) OR (diagnostics_consented = true))),
    CONSTRAINT feedback_reports_status_ck CHECK ((status = ANY (ARRAY['new'::text, 'read'::text, 'actioned'::text, 'declined'::text])))
);


--
-- Name: file_blobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.file_blobs (
    path text NOT NULL,
    mime text,
    bytes bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid
);


--
-- Name: incident_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    incident_id uuid NOT NULL,
    org_id uuid NOT NULL,
    from_state text,
    to_state text NOT NULL,
    actor text NOT NULL,
    detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: incident_requeues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_requeues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    incident_id uuid NOT NULL,
    org_id uuid NOT NULL,
    source_run_id uuid,
    agent text NOT NULL,
    opportunity_id uuid,
    idempotency_key text NOT NULL,
    queued_at timestamp with time zone DEFAULT now() NOT NULL,
    outcome text,
    outcome_at timestamp with time zone
);


--
-- Name: influencer_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.influencer_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    influencer_id uuid NOT NULL,
    code text NOT NULL,
    stripe_coupon_id text,
    stripe_promotion_code_id text,
    discount_percent numeric(5,2) NOT NULL,
    applies_to text DEFAULT 'both'::text NOT NULL,
    discount_months integer,
    commission_percent numeric(5,2),
    commission_months integer,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    max_redemptions integer,
    redemption_count integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: influencer_payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.influencer_payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    influencer_id uuid NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    earned_cents integer DEFAULT 0 NOT NULL,
    clawback_cents integer DEFAULT 0 NOT NULL,
    net_cents integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    stripe_transfer_id text,
    approved_by uuid,
    approved_at timestamp with time zone,
    paid_at timestamp with time zone,
    failure_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: influencers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.influencers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    stripe_account_id text,
    connect_details_submitted boolean DEFAULT false NOT NULL,
    connect_payouts_enabled boolean DEFAULT false NOT NULL,
    tax_status text,
    commission_percent numeric(5,2) DEFAULT 20.00 NOT NULL,
    commission_months integer,
    payout_threshold_cents integer DEFAULT 5000 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: integration_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_settings (
    env_key text NOT NULL,
    value_enc text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_validated_at timestamp with time zone,
    last_error text,
    org_id uuid NOT NULL,
    last_success_at timestamp with time zone,
    last_tested_at timestamp with time zone,
    quota_note text,
    expires_at timestamp with time zone
);


--
-- Name: integration_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_tokens (
    provider text NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    email text,
    status text DEFAULT 'connected'::text NOT NULL,
    last_error text,
    last_synced_at timestamp with time zone,
    history_id text,
    send_as text,
    display_name text
);


--
-- Name: job_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent text NOT NULL,
    trigger text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    error text,
    summary jsonb,
    org_id uuid,
    opportunity_id uuid
);


--
-- Name: kpi_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    win_rate numeric,
    avg_margin_on_wins numeric,
    pipeline_value numeric,
    active_contract_revenue numeric,
    by_naics jsonb DEFAULT '[]'::jsonb,
    by_agency jsonb DEFAULT '[]'::jsonb,
    by_state jsonb DEFAULT '[]'::jsonb,
    top_subs jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: opportunities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opportunities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    source_id text,
    solicitation_number text,
    title text,
    description text,
    naics_code text,
    psc_code text,
    set_aside_type text,
    value_estimated numeric,
    deadline timestamp with time zone,
    posted_at timestamp with time zone,
    location_state text,
    location_text text,
    agency text,
    sub_agency text,
    contact_json jsonb,
    attachments_json jsonb DEFAULT '[]'::jsonb,
    raw_json jsonb,
    score integer,
    score_breakdown jsonb,
    tier text,
    is_sources_sought boolean DEFAULT false NOT NULL,
    solicitation_analysis jsonb,
    past_perf_classification text,
    risk_flags text[] DEFAULT '{}'::text[],
    stage text DEFAULT 'monitoring'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    human_action_required boolean DEFAULT false NOT NULL,
    review_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    solicitation_text text,
    notes text,
    snoozed_until timestamp with time zone,
    value_estimated_source text,
    org_id uuid,
    analysis_input_hash text,
    pursuit_state text DEFAULT 'active'::text NOT NULL,
    pursuit_changed_at timestamp with time zone,
    pursuit_changed_by text,
    pursuit_reason text,
    pursuit_note text,
    pursuit_version integer DEFAULT 1 NOT NULL,
    assigned_to uuid,
    assigned_at timestamp with time zone,
    assigned_by uuid,
    review_warned_at timestamp with time zone,
    CONSTRAINT opportunities_pursuit_state_check CHECK ((pursuit_state = ANY (ARRAY['active'::text, 'paused'::text, 'aborted'::text])))
);


--
-- Name: COLUMN opportunities.value_estimated; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.opportunities.value_estimated IS 'Estimated contract value in whole US dollars (not cents).';


--
-- Name: COLUMN opportunities.solicitation_text; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.opportunities.solicitation_text IS 'Concatenated parsed text of the solicitation + attachments, capped, for re-audit.';


--
-- Name: COLUMN opportunities.analysis_input_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.opportunities.analysis_input_hash IS 'Hash of the documents and notice text the current solicitation_analysis was computed from. A forced re-analysis whose inputs hash the same is skipped rather than re-billed.';


--
-- Name: opportunity_subs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opportunity_subs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    opportunity_id uuid NOT NULL,
    subcontractor_id uuid NOT NULL,
    trade text,
    candidate_rank integer,
    verified boolean DEFAULT false NOT NULL,
    verification_json jsonb,
    outreach_state text DEFAULT 'pending'::text NOT NULL,
    responded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    role text,
    removed_at timestamp with time zone,
    removed_reason text,
    removed_by uuid,
    replaced_by uuid,
    quote_due_at timestamp with time zone,
    quoted_at timestamp with time zone,
    quote_full_scope boolean,
    CONSTRAINT opportunity_subs_removal_reason_ck CHECK (((removed_at IS NULL) OR (COALESCE(btrim(removed_reason), ''::text) <> ''::text))),
    CONSTRAINT opportunity_subs_role_check CHECK (((role IS NULL) OR (role = ANY (ARRAY['primary'::text, 'backup'::text]))))
);


--
-- Name: organization_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_members (
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'owner'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text,
    stripe_customer_id text,
    stripe_subscription_id text,
    stripe_price_id text,
    plan_key text DEFAULT 'none'::text NOT NULL,
    plan_amount_cents integer,
    subscription_status text DEFAULT 'none'::text NOT NULL,
    price_locked boolean DEFAULT false NOT NULL,
    trial_ends_at timestamp with time zone,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    billing_interval text,
    stripe_amount_cents integer,
    discount_code text,
    discount_percent_off numeric(5,2),
    discount_amount_off_cents integer,
    discount_ends_at timestamp with time zone,
    last_payment_status text,
    last_payment_at timestamp with time zone,
    last_payment_error text,
    billing_event_at timestamp with time zone,
    billing_exempt boolean DEFAULT false NOT NULL,
    billing_exempt_reason text,
    billing_exempt_granted_by text,
    billing_exempt_granted_at timestamp with time zone,
    suspended_at timestamp with time zone,
    suspended_reason text,
    suspended_by text,
    pending_concession_code text,
    pending_coupon_id text,
    pending_concession_label text,
    pending_concession_reason text,
    pending_concession_by text,
    pending_concession_at timestamp with time zone,
    next_payment_attempt_at timestamp with time zone,
    last_invoice_url text,
    deletion_scheduled_at timestamp with time zone,
    deletion_requested_by text,
    deletion_reason text,
    deletion_requested_at timestamp with time zone,
    card_brand text,
    card_last4 text,
    card_exp_month integer,
    card_exp_year integer,
    card_recorded_at timestamp with time zone,
    classification text DEFAULT 'customer'::text NOT NULL,
    CONSTRAINT organizations_card_last4_ck CHECK (((card_last4 IS NULL) OR (card_last4 ~ '^[0-9]{4}$'::text))),
    CONSTRAINT organizations_classification_ck CHECK ((classification = ANY (ARRAY['customer'::text, 'internal'::text, 'test'::text])))
);


--
-- Name: COLUMN organizations.billing_exempt; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.billing_exempt IS 'Full access regardless of subscription_status. Set for the platform owner and for comped accounts. Deliberately not a subscription_status value: Stripe webhooks overwrite that column.';


--
-- Name: COLUMN organizations.suspended_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.suspended_at IS 'Administrative suspension. Outranks billing_exempt. Data is retained; only access stops.';


--
-- Name: COLUMN organizations.pending_concession_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.pending_concession_code IS 'Our own short reference for the promised discount. Not redeemable by anyone.';


--
-- Name: COLUMN organizations.pending_coupon_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.pending_coupon_id IS 'Stripe coupon to attach at checkout for an account with no subscription yet. Deliberately outside the webhook writable set: it is our promise, not Stripe state. Cleared once Stripe reports the discount through discount_*.';


--
-- Name: COLUMN organizations.pending_concession_label; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.pending_concession_label IS 'The promise in plain language, shown to the customer on their billing page before they ever see a Stripe invoice.';


--
-- Name: outreach_suppressions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_suppressions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    subcontractor_id uuid NOT NULL,
    opportunity_id uuid,
    trade text,
    channel text NOT NULL,
    reason text NOT NULL,
    note text,
    actor text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    lifted_at timestamp with time zone,
    lifted_by text,
    CONSTRAINT outreach_suppressions_channel_ck CHECK ((channel = ANY (ARRAY['call'::text, 'email'::text, 'all'::text]))),
    CONSTRAINT outreach_suppressions_lift_ck CHECK ((((lifted_at IS NULL) AND (lifted_by IS NULL)) OR ((lifted_at IS NOT NULL) AND (length(btrim(COALESCE(lifted_by, ''::text))) > 0)))),
    CONSTRAINT outreach_suppressions_scope_ck CHECK (((trade IS NULL) OR (opportunity_id IS NOT NULL)))
);


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_key_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_key_grants (
    org_id uuid NOT NULL,
    env_key text NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    note text,
    expires_at timestamp with time zone
);


--
-- Name: platform_key_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_key_usage (
    org_id uuid NOT NULL,
    env_key text NOT NULL,
    calls integer DEFAULT 0 NOT NULL,
    first_used timestamp with time zone DEFAULT now() NOT NULL,
    last_used timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pricing_comps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_comps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    opportunity_id uuid,
    naics_code text,
    state text,
    award_amount numeric,
    award_amount_adj numeric,
    awarded_at date,
    recipient_name text,
    agency text,
    is_incumbent boolean DEFAULT false NOT NULL,
    raw_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid
);


--
-- Name: quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    opportunity_id uuid NOT NULL,
    subcontractor_id uuid,
    trade text,
    quote_amount numeric NOT NULL,
    payment_terms text,
    notes text,
    is_out_of_range boolean DEFAULT false NOT NULL,
    comparison_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid
);


--
-- Name: COLUMN quotes.quote_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.quotes.quote_amount IS 'Subcontractor quote in whole US dollars (not cents).';


--
-- Name: recap_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recap_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid,
    user_id uuid,
    recipient_email text NOT NULL,
    scope text DEFAULT 'org'::text NOT NULL,
    local_date date NOT NULL,
    timezone text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    late boolean DEFAULT false NOT NULL,
    quiet boolean DEFAULT false NOT NULL,
    test boolean DEFAULT false NOT NULL,
    due_at timestamp with time zone,
    sent_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    urgent_count integer DEFAULT 0 NOT NULL,
    subject text,
    html text,
    text_body text,
    provider_message_id text,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    provider_attempted_at timestamp with time zone,
    CONSTRAINT recap_deliveries_scope_check CHECK ((scope = ANY (ARRAY['org'::text, 'platform'::text]))),
    CONSTRAINT recap_deliveries_scope_org_ck CHECK ((((scope = 'platform'::text) AND (org_id IS NULL)) OR ((scope = 'org'::text) AND (org_id IS NOT NULL)))),
    CONSTRAINT recap_deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'bounced'::text])))
);


--
-- Name: recap_urgent_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recap_urgent_items (
    org_id uuid NOT NULL,
    item_key text NOT NULL,
    first_seen_on date NOT NULL,
    last_seen_on date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: referral_attributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_attributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    influencer_id uuid NOT NULL,
    code_id uuid NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    attributed_at timestamp with time zone DEFAULT now() NOT NULL,
    commission_percent numeric(5,2) NOT NULL,
    commission_months integer,
    commission_ends_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reply_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reply_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid,
    communication_id uuid NOT NULL,
    subcontractor_id uuid,
    opportunity_id uuid,
    generated_body text NOT NULL,
    edited_body text,
    warnings text[] DEFAULT '{}'::text[] NOT NULL,
    model text,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    rev bigint DEFAULT 0 NOT NULL
);


--
-- Name: requirement_state_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.requirement_state_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    requirement_id text NOT NULL,
    from_state text,
    to_state text NOT NULL,
    actor_kind text NOT NULL,
    actor_id uuid,
    actor_label text,
    note text,
    at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT requirement_state_events_actor_kind_check CHECK ((actor_kind = ANY (ARRAY['person'::text, 'automation'::text])))
);


--
-- Name: requirement_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.requirement_states (
    org_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    requirement_id text NOT NULL,
    state text DEFAULT 'not_started'::text NOT NULL,
    verification text DEFAULT 'upload'::text NOT NULL,
    human_verified boolean DEFAULT false NOT NULL,
    owner_id uuid,
    due_at timestamp with time zone,
    blocking_reason text,
    note text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT requirement_states_check CHECK (((state <> ALL (ARRAY['blocked'::text, 'needs_clarification'::text])) OR (COALESCE(btrim(blocking_reason), ''::text) <> ''::text))),
    CONSTRAINT requirement_states_state_check CHECK ((state = ANY (ARRAY['not_started'::text, 'in_progress'::text, 'needs_clarification'::text, 'blocked'::text, 'done'::text, 'not_applicable'::text]))),
    CONSTRAINT requirement_states_verification_check CHECK ((verification = ANY (ARRAY['none'::text, 'signature'::text, 'credential'::text, 'upload'::text, 'portal_action'::text])))
);


--
-- Name: sam_daily_calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sam_daily_calls (
    org_id uuid NOT NULL,
    day date DEFAULT ((now() AT TIME ZONE 'utc'::text))::date NOT NULL,
    calls integer DEFAULT 0 NOT NULL
);


--
-- Name: saved_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_views (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    page_key text NOT NULL,
    name text NOT NULL,
    query text NOT NULL,
    scope text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_id uuid,
    CONSTRAINT saved_views_check CHECK (((scope = 'team'::text) OR (owner_id IS NOT NULL))),
    CONSTRAINT saved_views_scope_check CHECK ((scope = ANY (ARRAY['personal'::text, 'team'::text])))
);


--
-- Name: scoring_weights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scoring_weights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version integer NOT NULL,
    weights jsonb NOT NULL,
    rationale text,
    is_active boolean DEFAULT false NOT NULL,
    proposed_at timestamp with time zone DEFAULT now() NOT NULL,
    proposed_by text DEFAULT 'system'::text NOT NULL,
    approved_at timestamp with time zone,
    approved_by text,
    supporting_data jsonb,
    org_id uuid
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id text NOT NULL,
    user_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    impersonator_user_id uuid,
    impersonator_email text,
    impersonator_session_id text,
    user_agent text,
    last_seen_at timestamp with time zone
);


--
-- Name: solicitation_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solicitation_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    scope text NOT NULL,
    state text DEFAULT 'queued'::text NOT NULL,
    requested_by text NOT NULL,
    queued_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    snapshot jsonb,
    fingerprint_before text,
    fingerprint_after text,
    documents_expected integer,
    documents_verified integer,
    documents_unreadable integer,
    pages_processed integer,
    findings jsonb DEFAULT '[]'::jsonb NOT NULL,
    failed_scopes text[] DEFAULT '{}'::text[] NOT NULL,
    error text,
    accepted_at timestamp with time zone,
    accepted_by text,
    idempotency_key text NOT NULL,
    CONSTRAINT solicitation_verifications_accept_ck CHECK ((((accepted_at IS NULL) AND (accepted_by IS NULL)) OR ((accepted_at IS NOT NULL) AND (length(btrim(COALESCE(accepted_by, ''::text))) > 0)))),
    CONSTRAINT solicitation_verifications_clean_ck CHECK (((state <> 'verified_no_changes'::text) OR ((finished_at IS NOT NULL) AND (COALESCE(documents_unreadable, 0) = 0) AND (array_length(failed_scopes, 1) IS NULL) AND (COALESCE(documents_verified, '-1'::integer) >= COALESCE(documents_expected, 0))))),
    CONSTRAINT solicitation_verifications_scope_ck CHECK ((scope = ANY (ARRAY['source_and_amendments'::text, 'documents'::text, 'requirements_and_deadlines'::text, 'trade_scopes'::text, 'scoring_and_eligibility'::text, 'bid_readiness'::text, 'full'::text]))),
    CONSTRAINT solicitation_verifications_state_ck CHECK ((state = ANY (ARRAY['not_verified'::text, 'queued'::text, 'in_progress'::text, 'verified_no_changes'::text, 'changes_found'::text, 'conflicts_found'::text, 'partially_verified'::text, 'failed'::text, 'stale'::text])))
);


--
-- Name: stripe_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_events (
    id text NOT NULL,
    type text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    org_id uuid,
    processed_at timestamp with time zone DEFAULT now() NOT NULL,
    error text
);


--
-- Name: subcontractor_bulk_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subcontractor_bulk_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    kind text NOT NULL,
    detail text,
    affected jsonb DEFAULT '[]'::jsonb NOT NULL,
    skipped jsonb DEFAULT '[]'::jsonb NOT NULL,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    undone_at timestamp with time zone,
    undone_by uuid,
    CONSTRAINT subcontractor_bulk_actions_kind_ck CHECK ((kind = ANY (ARRAY['verify'::text, 'tag'::text, 'untag'::text, 'archive'::text]))),
    CONSTRAINT subcontractor_bulk_actions_undo_ck CHECK (((undone_at IS NULL) OR (jsonb_array_length(affected) > 0)))
);


--
-- Name: subcontractor_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subcontractor_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    subcontractor_id uuid NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    email text,
    phone text,
    email_verified boolean DEFAULT false NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subcontractor_contacts_name_ck CHECK ((length(btrim(name)) > 0)),
    CONSTRAINT subcontractor_contacts_reachable_ck CHECK (((COALESCE(btrim(email), ''::text) <> ''::text) OR (COALESCE(btrim(phone), ''::text) <> ''::text))),
    CONSTRAINT subcontractor_contacts_role_ck CHECK ((role = ANY (ARRAY['estimator'::text, 'owner'::text, 'foreman'::text, 'office'::text, 'accounts'::text, 'other'::text])))
);


--
-- Name: subcontractor_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subcontractor_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid,
    subcontractor_id uuid NOT NULL,
    doc_type text NOT NULL,
    storage_path text,
    original_filename text,
    mime_type text,
    carrier text,
    policy_number text,
    coverage_cents bigint,
    effective_at timestamp with time zone,
    expires_at timestamp with time zone,
    signed_name text,
    signed_at timestamp with time zone,
    signed_ip text,
    signed_user_agent text,
    signed_doc_hash text,
    status text DEFAULT 'pending'::text NOT NULL,
    verified_by uuid,
    verified_at timestamp with time zone,
    rejection_reason text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    w9_legal_name text,
    w9_business_name text,
    w9_tax_classification text,
    w9_llc_tax_class text,
    w9_exempt_payee_code text,
    w9_fatca_code text,
    w9_address text,
    w9_city text,
    w9_state text,
    w9_zip text,
    w9_tin_type text,
    w9_tin_last4 text,
    w9_tin_encrypted text,
    w9_certification_version text,
    source text DEFAULT 'operator'::text NOT NULL
);


--
-- Name: subcontractor_licenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subcontractor_licenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    subcontractor_id uuid NOT NULL,
    trade text NOT NULL,
    jurisdiction text,
    number text,
    status text,
    expires_at date,
    verified_at timestamp with time zone,
    source text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subcontractor_licenses_status_ck CHECK (((status IS NULL) OR (status = ANY (ARRAY['active'::text, 'expired'::text, 'suspended'::text, 'not_found'::text])))),
    CONSTRAINT subcontractor_licenses_trade_ck CHECK ((length(btrim(trade)) > 0))
);


--
-- Name: subcontractor_merges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subcontractor_merges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    survivor_id uuid NOT NULL,
    merged_id uuid NOT NULL,
    merged_snapshot jsonb NOT NULL,
    field_decisions jsonb DEFAULT '{}'::jsonb NOT NULL,
    moved jsonb DEFAULT '{}'::jsonb NOT NULL,
    reversible boolean DEFAULT true NOT NULL,
    irreversible_reason text,
    actor_id uuid,
    actor_email text,
    at timestamp with time zone DEFAULT now() NOT NULL,
    undone_at timestamp with time zone,
    undone_by uuid,
    CONSTRAINT subcontractor_merges_check CHECK ((reversible OR (COALESCE(btrim(irreversible_reason), ''::text) <> ''::text))),
    CONSTRAINT subcontractor_merges_check1 CHECK ((survivor_id <> merged_id))
);


--
-- Name: subcontractor_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subcontractor_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid,
    subcontractor_id uuid NOT NULL,
    opportunity_id uuid,
    amount_cents bigint NOT NULL,
    paid_at timestamp with time zone NOT NULL,
    tax_year integer NOT NULL,
    memo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subcontractor_performance_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subcontractor_performance_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    subcontractor_id uuid NOT NULL,
    opportunity_id uuid,
    kind text NOT NULL,
    note text,
    recorded_by uuid,
    recorded_by_email text,
    at timestamp with time zone DEFAULT now() NOT NULL,
    retracted_at timestamp with time zone,
    retracted_reason text,
    retracted_by uuid,
    CONSTRAINT subcontractor_performance_events_check CHECK (((kind = 'completed'::text) OR (COALESCE(btrim(note), ''::text) <> ''::text))),
    CONSTRAINT subcontractor_performance_events_check1 CHECK (((retracted_at IS NULL) OR (COALESCE(btrim(retracted_reason), ''::text) <> ''::text))),
    CONSTRAINT subcontractor_performance_events_kind_check CHECK ((kind = ANY (ARRAY['completed'::text, 'issue'::text, 'cancelled'::text])))
);


--
-- Name: subcontractor_reply_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subcontractor_reply_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid,
    subcontractor_id uuid NOT NULL,
    opportunity_id uuid,
    trade text,
    intent text NOT NULL,
    reason text,
    original_message text,
    gmail_message_id text,
    gmail_thread_id text,
    extracted jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence numeric(3,2) DEFAULT 0 NOT NULL,
    needs_review boolean DEFAULT false NOT NULL,
    review_reason text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subcontractor_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subcontractor_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    subcontractor_id uuid NOT NULL,
    tag text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    CONSTRAINT subcontractor_tags_tag_ck CHECK (((length(btrim(tag)) >= 1) AND (length(btrim(tag)) <= 40)))
);


--
-- Name: subcontractors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subcontractors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_name text NOT NULL,
    owner_name text,
    trade_categories text[] DEFAULT '{}'::text[],
    naics_codes text[] DEFAULT '{}'::text[],
    state text,
    city text,
    address text,
    email text,
    email_verified boolean DEFAULT false NOT NULL,
    phone text,
    website text,
    license_number text,
    license_status text,
    sam_excluded boolean DEFAULT false NOT NULL,
    google_rating numeric,
    review_count integer,
    google_place_id text,
    responsiveness_score numeric,
    reliability_score numeric,
    sb_certified boolean,
    business_age_years integer,
    project_history jsonb DEFAULT '[]'::jsonb,
    is_preferred boolean DEFAULT false NOT NULL,
    blacklisted boolean DEFAULT false NOT NULL,
    bbb_summary text,
    reviews_summary text,
    last_contacted timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    extra_fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    contact_status text,
    email_source text,
    contact_checked_at timestamp with time zone,
    org_id uuid,
    assigned_to uuid,
    assigned_at timestamp with time zone,
    assigned_by uuid,
    merged_into uuid,
    archived_at timestamp with time zone,
    archived_reason text,
    archived_by uuid,
    blacklist_reason text,
    blacklisted_at timestamp with time zone,
    blacklisted_by uuid,
    service_area_states text[],
    service_radius_miles integer,
    service_area_note text,
    crew_size integer,
    concurrent_jobs integer,
    min_project_cents bigint,
    max_project_cents bigint,
    bonded boolean,
    bond_single_cents bigint,
    bond_aggregate_cents bigint,
    bond_surety text,
    certifications text[],
    payment_terms text,
    quote_validity_days integer,
    preferred_contact text,
    time_zone text,
    source text,
    source_confidence text,
    capability_updated_at timestamp with time zone,
    capability_updated_by uuid,
    CONSTRAINT subcontractors_archive_reason_ck CHECK (((archived_at IS NULL) OR (COALESCE(btrim(archived_reason), ''::text) <> ''::text))),
    CONSTRAINT subcontractors_bond_ck CHECK (((bonded IS NOT FALSE) OR ((bond_single_cents IS NULL) AND (bond_aggregate_cents IS NULL)))),
    CONSTRAINT subcontractors_capacity_ck CHECK ((((crew_size IS NULL) OR (crew_size > 0)) AND ((concurrent_jobs IS NULL) OR (concurrent_jobs > 0)) AND ((service_radius_miles IS NULL) OR (service_radius_miles > 0)) AND ((quote_validity_days IS NULL) OR (quote_validity_days > 0)) AND ((min_project_cents IS NULL) OR (min_project_cents >= 0)) AND ((max_project_cents IS NULL) OR (max_project_cents >= 0)) AND ((min_project_cents IS NULL) OR (max_project_cents IS NULL) OR (max_project_cents >= min_project_cents)) AND ((bond_single_cents IS NULL) OR (bond_single_cents >= 0)) AND ((bond_aggregate_cents IS NULL) OR (bond_aggregate_cents >= 0)) AND ((bond_single_cents IS NULL) OR (bond_aggregate_cents IS NULL) OR (bond_aggregate_cents >= bond_single_cents)))),
    CONSTRAINT subcontractors_merged_is_archived_ck CHECK (((merged_into IS NULL) OR (archived_at IS NOT NULL))),
    CONSTRAINT subcontractors_merged_not_self_ck CHECK ((merged_into IS DISTINCT FROM id)),
    CONSTRAINT subcontractors_preferred_contact_ck CHECK (((preferred_contact IS NULL) OR (preferred_contact = ANY (ARRAY['email'::text, 'phone'::text, 'text'::text])))),
    CONSTRAINT subcontractors_source_confidence_ck CHECK (((source_confidence IS NULL) OR (source_confidence = ANY (ARRAY['confirmed'::text, 'reported'::text, 'inferred'::text]))))
);


--
-- Name: templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    subject text,
    body text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid,
    status text DEFAULT 'published'::text NOT NULL,
    drafted_at timestamp with time zone,
    drafted_by text,
    published_at timestamp with time zone,
    published_by text,
    CONSTRAINT templates_draft_not_active_ck CHECK (((status = 'published'::text) OR (is_active = false))),
    CONSTRAINT templates_status_ck CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text])))
);


--
-- Name: trade_pricing_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trade_pricing_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    scope_key text NOT NULL,
    trade text NOT NULL,
    selected_sub_id uuid,
    backup_sub_id uuid,
    base_quote numeric,
    taxes numeric,
    freight numeric,
    mobilization numeric,
    bonding numeric,
    manual_adjustment numeric,
    manual_adjustment_reason text,
    pending_components text[] DEFAULT '{}'::text[] NOT NULL,
    alternates jsonb DEFAULT '[]'::jsonb NOT NULL,
    exclusions jsonb DEFAULT '[]'::jsonb NOT NULL,
    payment_terms text,
    quote_expires_on date,
    availability text,
    lead_time_days integer,
    confidence text DEFAULT 'unknown'::text NOT NULL,
    supporting_document_id uuid,
    source_quote_id uuid,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trade_pricing_adjustment_reason_ck CHECK (((manual_adjustment IS NULL) OR (manual_adjustment = (0)::numeric) OR (length(btrim(COALESCE(manual_adjustment_reason, ''::text))) >= 20))),
    CONSTRAINT trade_pricing_backup_ck CHECK (((backup_sub_id IS NULL) OR (backup_sub_id IS DISTINCT FROM selected_sub_id))),
    CONSTRAINT trade_pricing_confidence_ck CHECK ((confidence = ANY (ARRAY['firm'::text, 'budgetary'::text, 'rough'::text, 'unknown'::text]))),
    CONSTRAINT trade_pricing_lead_time_ck CHECK (((lead_time_days IS NULL) OR (lead_time_days >= 0))),
    CONSTRAINT trade_pricing_nonneg_ck CHECK (((COALESCE(base_quote, (0)::numeric) >= (0)::numeric) AND (COALESCE(taxes, (0)::numeric) >= (0)::numeric) AND (COALESCE(freight, (0)::numeric) >= (0)::numeric) AND (COALESCE(mobilization, (0)::numeric) >= (0)::numeric) AND (COALESCE(bonding, (0)::numeric) >= (0)::numeric)))
);


--
-- Name: unmatched_inbound; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unmatched_inbound (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    from_email text NOT NULL,
    from_name text,
    subject text,
    snippet text,
    gmail_thread_id text,
    message_id text,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    subcontractor_id uuid,
    state text DEFAULT 'needs_matching'::text NOT NULL,
    matched_communication_id uuid,
    matched_opportunity_id uuid,
    matched_by text,
    matched_at timestamp with time zone,
    dismissed_reason text,
    dismissed_by text,
    dismissed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT unmatched_inbound_dismiss_ck CHECK (((state <> 'dismissed'::text) OR (COALESCE(btrim(dismissed_reason), ''::text) <> ''::text))),
    CONSTRAINT unmatched_inbound_matched_ck CHECK (((state <> 'matched'::text) OR (matched_opportunity_id IS NOT NULL))),
    CONSTRAINT unmatched_inbound_state_ck CHECK ((state = ANY (ARRAY['needs_matching'::text, 'matched'::text, 'dismissed'::text])))
);


--
-- Name: user_email_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_email_aliases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    name text,
    role text DEFAULT 'operator'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    timezone text,
    recap_opt_out boolean DEFAULT false NOT NULL
);


--
-- Name: worker_heartbeat; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_heartbeat (
    id text NOT NULL,
    instance_id text NOT NULL,
    phase text NOT NULL,
    detail text,
    booted_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98 FOR VALUES IN ('compliance-monitor');


--
-- Name: j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7 FOR VALUES IN ('account-deletion-sweep');


--
-- Name: j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1 FOR VALUES IN ('analytics-engine');


--
-- Name: j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd FOR VALUES IN ('reply-poll');


--
-- Name: j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc FOR VALUES IN ('trial-sweep');


--
-- Name: j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688 FOR VALUES IN ('scoring-engine');


--
-- Name: j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc FOR VALUES IN ('outreach');


--
-- Name: j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55 FOR VALUES IN ('sub-finder');


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 FOR VALUES IN ('__pgboss__send-it');


--
-- Name: j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971 FOR VALUES IN ('sub-verify');


--
-- Name: j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1 FOR VALUES IN ('contact-recheck-sweep');


--
-- Name: j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c FOR VALUES IN ('sources-sought-responder');


--
-- Name: j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481 FOR VALUES IN ('scoring-recovery-sweep');


--
-- Name: j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3 FOR VALUES IN ('daily-recap');


--
-- Name: j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6 FOR VALUES IN ('log-retention-sweep');


--
-- Name: j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf FOR VALUES IN ('deadline-monitor');


--
-- Name: ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63 FOR VALUES IN ('review-expiry-sweep');


--
-- Name: jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d FOR VALUES IN ('backlink-scout');


--
-- Name: jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6 FOR VALUES IN ('outreach-recovery-sweep');


--
-- Name: jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3 FOR VALUES IN ('pricing-research');


--
-- Name: jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce FOR VALUES IN ('learning-loop');


--
-- Name: jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291 FOR VALUES IN ('call-prep');


--
-- Name: jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb FOR VALUES IN ('reverify');


--
-- Name: jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5 FOR VALUES IN ('unresponsive-sweep');


--
-- Name: jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821 FOR VALUES IN ('opportunity-monitor');


--
-- Name: jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd FOR VALUES IN ('compliance-auditor');


--
-- Name: jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8 FOR VALUES IN ('expired-opportunity-sweep');


--
-- Name: jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026 FOR VALUES IN ('backlink-outreach-sweep');


--
-- Name: je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87 FOR VALUES IN ('stalled-pipeline-sweep');


--
-- Name: je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250 FOR VALUES IN ('sub-onboarding');


--
-- Name: jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce FOR VALUES IN ('retention-sweep');


--
-- Name: jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8 FOR VALUES IN ('concession-sweep');


--
-- Name: jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219 FOR VALUES IN ('outreach-followup');


--
-- Name: jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c FOR VALUES IN ('solicitation-analyst');


--
-- Name: jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886 FOR VALUES IN ('compliance-sweep');


--
-- Name: jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0 FOR VALUES IN ('bid-builder');


--
-- Name: archive archive_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.archive
    ADD CONSTRAINT archive_pkey PRIMARY KEY (name, id);


--
-- Name: job job_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job
    ADD CONSTRAINT job_pkey PRIMARY KEY (name, id);


--
-- Name: j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98 j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98
    ADD CONSTRAINT j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98_pkey PRIMARY KEY (name, id);


--
-- Name: j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7 j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7
    ADD CONSTRAINT j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7_pkey PRIMARY KEY (name, id);


--
-- Name: j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1 j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1
    ADD CONSTRAINT j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1_pkey PRIMARY KEY (name, id);


--
-- Name: j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd
    ADD CONSTRAINT j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd_pkey PRIMARY KEY (name, id);


--
-- Name: j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc
    ADD CONSTRAINT j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc_pkey PRIMARY KEY (name, id);


--
-- Name: j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688 j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688
    ADD CONSTRAINT j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688_pkey PRIMARY KEY (name, id);


--
-- Name: j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc
    ADD CONSTRAINT j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc_pkey PRIMARY KEY (name, id);


--
-- Name: j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55 j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55
    ADD CONSTRAINT j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55_pkey PRIMARY KEY (name, id);


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3
    ADD CONSTRAINT j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_pkey PRIMARY KEY (name, id);


--
-- Name: j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971 j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971
    ADD CONSTRAINT j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971_pkey PRIMARY KEY (name, id);


--
-- Name: j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1 j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1
    ADD CONSTRAINT j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1_pkey PRIMARY KEY (name, id);


--
-- Name: j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c
    ADD CONSTRAINT j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c_pkey PRIMARY KEY (name, id);


--
-- Name: j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481 j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481
    ADD CONSTRAINT j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481_pkey PRIMARY KEY (name, id);


--
-- Name: j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3 j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3
    ADD CONSTRAINT j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3_pkey PRIMARY KEY (name, id);


--
-- Name: j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6 j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6
    ADD CONSTRAINT j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6_pkey PRIMARY KEY (name, id);


--
-- Name: j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf
    ADD CONSTRAINT j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf_pkey PRIMARY KEY (name, id);


--
-- Name: ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63 ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63
    ADD CONSTRAINT ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63_pkey PRIMARY KEY (name, id);


--
-- Name: jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d
    ADD CONSTRAINT jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d_pkey PRIMARY KEY (name, id);


--
-- Name: jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6 jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6
    ADD CONSTRAINT jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6_pkey PRIMARY KEY (name, id);


--
-- Name: jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3 jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3
    ADD CONSTRAINT jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3_pkey PRIMARY KEY (name, id);


--
-- Name: jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce
    ADD CONSTRAINT jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce_pkey PRIMARY KEY (name, id);


--
-- Name: jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291 jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291
    ADD CONSTRAINT jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291_pkey PRIMARY KEY (name, id);


--
-- Name: jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb
    ADD CONSTRAINT jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb_pkey PRIMARY KEY (name, id);


--
-- Name: jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5 jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5
    ADD CONSTRAINT jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5_pkey PRIMARY KEY (name, id);


--
-- Name: jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821 jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821
    ADD CONSTRAINT jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821_pkey PRIMARY KEY (name, id);


--
-- Name: jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd
    ADD CONSTRAINT jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd_pkey PRIMARY KEY (name, id);


--
-- Name: jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8 jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8
    ADD CONSTRAINT jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8_pkey PRIMARY KEY (name, id);


--
-- Name: jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026 jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026
    ADD CONSTRAINT jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026_pkey PRIMARY KEY (name, id);


--
-- Name: je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87 je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87
    ADD CONSTRAINT je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87_pkey PRIMARY KEY (name, id);


--
-- Name: je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250 je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250
    ADD CONSTRAINT je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250_pkey PRIMARY KEY (name, id);


--
-- Name: jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce
    ADD CONSTRAINT jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce_pkey PRIMARY KEY (name, id);


--
-- Name: jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8 jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8
    ADD CONSTRAINT jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8_pkey PRIMARY KEY (name, id);


--
-- Name: jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219 jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219
    ADD CONSTRAINT jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219_pkey PRIMARY KEY (name, id);


--
-- Name: jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c
    ADD CONSTRAINT jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c_pkey PRIMARY KEY (name, id);


--
-- Name: jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886 jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886
    ADD CONSTRAINT jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886_pkey PRIMARY KEY (name, id);


--
-- Name: jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0 jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0
    ADD CONSTRAINT jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0_pkey PRIMARY KEY (name, id);


--
-- Name: queue queue_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.queue
    ADD CONSTRAINT queue_pkey PRIMARY KEY (name);


--
-- Name: schedule schedule_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.schedule
    ADD CONSTRAINT schedule_pkey PRIMARY KEY (name);


--
-- Name: subscription subscription_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.subscription
    ADD CONSTRAINT subscription_pkey PRIMARY KEY (event, name);


--
-- Name: version version_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.version
    ADD CONSTRAINT version_pkey PRIMARY KEY (version);


--
-- Name: _migrations _migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migrations
    ADD CONSTRAINT _migrations_pkey PRIMARY KEY (name);


--
-- Name: account_invitations account_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_invitations
    ADD CONSTRAINT account_invitations_pkey PRIMARY KEY (id);


--
-- Name: admin_audit_log admin_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);


--
-- Name: agent_logs agent_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_logs
    ADD CONSTRAINT agent_logs_pkey PRIMARY KEY (id);


--
-- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: authority_snapshots authority_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authority_snapshots
    ADD CONSTRAINT authority_snapshots_pkey PRIMARY KEY (id);


--
-- Name: automation_incidents automation_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_incidents
    ADD CONSTRAINT automation_incidents_pkey PRIMARY KEY (id);


--
-- Name: backlink_competitors backlink_competitors_domain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backlink_competitors
    ADD CONSTRAINT backlink_competitors_domain_key UNIQUE (domain);


--
-- Name: backlink_competitors backlink_competitors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backlink_competitors
    ADD CONSTRAINT backlink_competitors_pkey PRIMARY KEY (id);


--
-- Name: backlink_outreach backlink_outreach_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backlink_outreach
    ADD CONSTRAINT backlink_outreach_pkey PRIMARY KEY (id);


--
-- Name: backlink_prospects backlink_prospects_domain_opportunity_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backlink_prospects
    ADD CONSTRAINT backlink_prospects_domain_opportunity_type_key UNIQUE (domain, opportunity_type);


--
-- Name: backlink_prospects backlink_prospects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backlink_prospects
    ADD CONSTRAINT backlink_prospects_pkey PRIMARY KEY (id);


--
-- Name: backlinks backlinks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backlinks
    ADD CONSTRAINT backlinks_pkey PRIMARY KEY (id);


--
-- Name: backlinks backlinks_source_url_target_url_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backlinks
    ADD CONSTRAINT backlinks_source_url_target_url_key UNIQUE (source_url, target_url);


--
-- Name: bid_calculation_snapshots bid_calculation_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bid_calculation_snapshots
    ADD CONSTRAINT bid_calculation_snapshots_pkey PRIMARY KEY (id);


--
-- Name: bid_overrides bid_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bid_overrides
    ADD CONSTRAINT bid_overrides_pkey PRIMARY KEY (id);


--
-- Name: bid_submission_events bid_submission_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bid_submission_events
    ADD CONSTRAINT bid_submission_events_pkey PRIMARY KEY (id);


--
-- Name: bids bids_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bids
    ADD CONSTRAINT bids_pkey PRIMARY KEY (id);


--
-- Name: billing_invoices billing_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_invoices
    ADD CONSTRAINT billing_invoices_pkey PRIMARY KEY (id);


--
-- Name: billing_invoices billing_invoices_stripe_invoice_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_invoices
    ADD CONSTRAINT billing_invoices_stripe_invoice_id_key UNIQUE (stripe_invoice_id);


--
-- Name: call_cards call_cards_opportunity_id_subcontractor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_cards
    ADD CONSTRAINT call_cards_opportunity_id_subcontractor_id_key UNIQUE (opportunity_id, subcontractor_id);


--
-- Name: call_cards call_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_cards
    ADD CONSTRAINT call_cards_pkey PRIMARY KEY (id);


--
-- Name: commission_events commission_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_events
    ADD CONSTRAINT commission_events_pkey PRIMARY KEY (id);


--
-- Name: communications communications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_pkey PRIMARY KEY (id);


--
-- Name: communications communications_tracking_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_tracking_id_key UNIQUE (tracking_id);


--
-- Name: company_profile company_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_profile
    ADD CONSTRAINT company_profile_pkey PRIMARY KEY (id);


--
-- Name: compliance_item_documents compliance_item_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_item_documents
    ADD CONSTRAINT compliance_item_documents_pkey PRIMARY KEY (id);


--
-- Name: compliance_item_events compliance_item_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_item_events
    ADD CONSTRAINT compliance_item_events_pkey PRIMARY KEY (id);


--
-- Name: compliance_items compliance_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_items
    ADD CONSTRAINT compliance_items_pkey PRIMARY KEY (id);


--
-- Name: content_library content_library_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_library
    ADD CONSTRAINT content_library_pkey PRIMARY KEY (id);


--
-- Name: contract_coordination contract_coordination_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_coordination
    ADD CONSTRAINT contract_coordination_pkey PRIMARY KEY (id);


--
-- Name: contract_invoices contract_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_invoices
    ADD CONSTRAINT contract_invoices_pkey PRIMARY KEY (id);


--
-- Name: contract_issues contract_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_issues
    ADD CONSTRAINT contract_issues_pkey PRIMARY KEY (id);


--
-- Name: contract_milestones contract_milestones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_milestones
    ADD CONSTRAINT contract_milestones_pkey PRIMARY KEY (id);


--
-- Name: contract_modifications contract_modifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_modifications
    ADD CONSTRAINT contract_modifications_pkey PRIMARY KEY (id);


--
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pkey PRIMARY KEY (id);


--
-- Name: conversation_flags conversation_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_flags
    ADD CONSTRAINT conversation_flags_pkey PRIMARY KEY (org_id, thread_key);


--
-- Name: custom_kpis custom_kpis_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_kpis
    ADD CONSTRAINT custom_kpis_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: email_suppressions email_suppressions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_suppressions
    ADD CONSTRAINT email_suppressions_pkey PRIMARY KEY (id);


--
-- Name: feedback_reports feedback_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_reports
    ADD CONSTRAINT feedback_reports_pkey PRIMARY KEY (id);


--
-- Name: file_blobs file_blobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_blobs
    ADD CONSTRAINT file_blobs_pkey PRIMARY KEY (path);


--
-- Name: incident_events incident_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_events
    ADD CONSTRAINT incident_events_pkey PRIMARY KEY (id);


--
-- Name: incident_requeues incident_requeues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_requeues
    ADD CONSTRAINT incident_requeues_pkey PRIMARY KEY (id);


--
-- Name: influencer_codes influencer_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.influencer_codes
    ADD CONSTRAINT influencer_codes_pkey PRIMARY KEY (id);


--
-- Name: influencer_payouts influencer_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.influencer_payouts
    ADD CONSTRAINT influencer_payouts_pkey PRIMARY KEY (id);


--
-- Name: influencer_payouts influencer_payouts_stripe_transfer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.influencer_payouts
    ADD CONSTRAINT influencer_payouts_stripe_transfer_id_key UNIQUE (stripe_transfer_id);


--
-- Name: influencers influencers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.influencers
    ADD CONSTRAINT influencers_pkey PRIMARY KEY (id);


--
-- Name: influencers influencers_stripe_account_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.influencers
    ADD CONSTRAINT influencers_stripe_account_id_key UNIQUE (stripe_account_id);


--
-- Name: integration_settings integration_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_settings
    ADD CONSTRAINT integration_settings_pkey PRIMARY KEY (env_key, org_id);


--
-- Name: integration_tokens integration_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_tokens
    ADD CONSTRAINT integration_tokens_pkey PRIMARY KEY (provider, org_id);


--
-- Name: job_runs job_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_pkey PRIMARY KEY (id);


--
-- Name: kpi_snapshots kpi_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_snapshots
    ADD CONSTRAINT kpi_snapshots_pkey PRIMARY KEY (id);


--
-- Name: opportunities opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_pkey PRIMARY KEY (id);


--
-- Name: opportunity_subs opportunity_subs_opportunity_id_subcontractor_id_trade_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_subs
    ADD CONSTRAINT opportunity_subs_opportunity_id_subcontractor_id_trade_key UNIQUE (opportunity_id, subcontractor_id, trade);


--
-- Name: opportunity_subs opportunity_subs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_subs
    ADD CONSTRAINT opportunity_subs_pkey PRIMARY KEY (id);


--
-- Name: organization_members organization_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_pkey PRIMARY KEY (org_id, user_id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);


--
-- Name: organizations organizations_stripe_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_stripe_customer_id_key UNIQUE (stripe_customer_id);


--
-- Name: organizations organizations_stripe_subscription_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_stripe_subscription_id_key UNIQUE (stripe_subscription_id);


--
-- Name: outreach_suppressions outreach_suppressions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_suppressions
    ADD CONSTRAINT outreach_suppressions_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: platform_key_grants platform_key_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_key_grants
    ADD CONSTRAINT platform_key_grants_pkey PRIMARY KEY (org_id, env_key);


--
-- Name: platform_key_usage platform_key_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_key_usage
    ADD CONSTRAINT platform_key_usage_pkey PRIMARY KEY (org_id, env_key);


--
-- Name: pricing_comps pricing_comps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_comps
    ADD CONSTRAINT pricing_comps_pkey PRIMARY KEY (id);


--
-- Name: quotes quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_pkey PRIMARY KEY (id);


--
-- Name: recap_deliveries recap_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recap_deliveries
    ADD CONSTRAINT recap_deliveries_pkey PRIMARY KEY (id);


--
-- Name: recap_urgent_items recap_urgent_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recap_urgent_items
    ADD CONSTRAINT recap_urgent_items_pkey PRIMARY KEY (org_id, item_key);


--
-- Name: referral_attributions referral_attributions_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_attributions
    ADD CONSTRAINT referral_attributions_org_id_key UNIQUE (org_id);


--
-- Name: referral_attributions referral_attributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_attributions
    ADD CONSTRAINT referral_attributions_pkey PRIMARY KEY (id);


--
-- Name: reply_drafts reply_drafts_communication_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reply_drafts
    ADD CONSTRAINT reply_drafts_communication_id_key UNIQUE (communication_id);


--
-- Name: reply_drafts reply_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reply_drafts
    ADD CONSTRAINT reply_drafts_pkey PRIMARY KEY (id);


--
-- Name: requirement_state_events requirement_state_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirement_state_events
    ADD CONSTRAINT requirement_state_events_pkey PRIMARY KEY (id);


--
-- Name: requirement_states requirement_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirement_states
    ADD CONSTRAINT requirement_states_pkey PRIMARY KEY (opportunity_id, requirement_id);


--
-- Name: sam_daily_calls sam_daily_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sam_daily_calls
    ADD CONSTRAINT sam_daily_calls_pkey PRIMARY KEY (org_id, day);


--
-- Name: saved_views saved_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_views
    ADD CONSTRAINT saved_views_pkey PRIMARY KEY (id);


--
-- Name: scoring_weights scoring_weights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_weights
    ADD CONSTRAINT scoring_weights_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: solicitation_verifications solicitation_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitation_verifications
    ADD CONSTRAINT solicitation_verifications_pkey PRIMARY KEY (id);


--
-- Name: stripe_events stripe_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_events
    ADD CONSTRAINT stripe_events_pkey PRIMARY KEY (id);


--
-- Name: subcontractor_bulk_actions subcontractor_bulk_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_bulk_actions
    ADD CONSTRAINT subcontractor_bulk_actions_pkey PRIMARY KEY (id);


--
-- Name: subcontractor_contacts subcontractor_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_contacts
    ADD CONSTRAINT subcontractor_contacts_pkey PRIMARY KEY (id);


--
-- Name: subcontractor_documents subcontractor_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_documents
    ADD CONSTRAINT subcontractor_documents_pkey PRIMARY KEY (id);


--
-- Name: subcontractor_licenses subcontractor_licenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_licenses
    ADD CONSTRAINT subcontractor_licenses_pkey PRIMARY KEY (id);


--
-- Name: subcontractor_merges subcontractor_merges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_merges
    ADD CONSTRAINT subcontractor_merges_pkey PRIMARY KEY (id);


--
-- Name: subcontractor_payments subcontractor_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_payments
    ADD CONSTRAINT subcontractor_payments_pkey PRIMARY KEY (id);


--
-- Name: subcontractor_performance_events subcontractor_performance_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_performance_events
    ADD CONSTRAINT subcontractor_performance_events_pkey PRIMARY KEY (id);


--
-- Name: subcontractor_reply_events subcontractor_reply_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_reply_events
    ADD CONSTRAINT subcontractor_reply_events_pkey PRIMARY KEY (id);


--
-- Name: subcontractor_tags subcontractor_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_tags
    ADD CONSTRAINT subcontractor_tags_pkey PRIMARY KEY (id);


--
-- Name: subcontractors subcontractors_blacklist_reason_ck; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.subcontractors
    ADD CONSTRAINT subcontractors_blacklist_reason_ck CHECK (((blacklisted = false) OR (length(btrim(COALESCE(blacklist_reason, ''::text))) >= 3))) NOT VALID;


--
-- Name: subcontractors subcontractors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractors
    ADD CONSTRAINT subcontractors_pkey PRIMARY KEY (id);


--
-- Name: templates templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_pkey PRIMARY KEY (id);


--
-- Name: trade_pricing_rows trade_pricing_rows_opportunity_id_scope_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_pricing_rows
    ADD CONSTRAINT trade_pricing_rows_opportunity_id_scope_key_key UNIQUE (opportunity_id, scope_key);


--
-- Name: trade_pricing_rows trade_pricing_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_pricing_rows
    ADD CONSTRAINT trade_pricing_rows_pkey PRIMARY KEY (id);


--
-- Name: unmatched_inbound unmatched_inbound_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unmatched_inbound
    ADD CONSTRAINT unmatched_inbound_pkey PRIMARY KEY (id);


--
-- Name: user_email_aliases user_email_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_email_aliases
    ADD CONSTRAINT user_email_aliases_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: worker_heartbeat worker_heartbeat_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_heartbeat
    ADD CONSTRAINT worker_heartbeat_pkey PRIMARY KEY (id);


--
-- Name: archive_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX archive_i1 ON pgboss.archive USING btree (archived_on);


--
-- Name: j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98_i1 ON pgboss.j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98_i2 ON pgboss.j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98_i3 ON pgboss.j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98_i4 ON pgboss.j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98_i5 ON pgboss.j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7_i1 ON pgboss.j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7_i2 ON pgboss.j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7_i3 ON pgboss.j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7_i4 ON pgboss.j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7_i5 ON pgboss.j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1_i1 ON pgboss.j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1_i2 ON pgboss.j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1_i3 ON pgboss.j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1_i4 ON pgboss.j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1_i5 ON pgboss.j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd_i1 ON pgboss.j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd_i2 ON pgboss.j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd_i3 ON pgboss.j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd_i4 ON pgboss.j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd_i5 ON pgboss.j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc_i1 ON pgboss.j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc_i2 ON pgboss.j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc_i3 ON pgboss.j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc_i4 ON pgboss.j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc_i5 ON pgboss.j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688_i1 ON pgboss.j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688_i2 ON pgboss.j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688_i3 ON pgboss.j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688_i4 ON pgboss.j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688_i5 ON pgboss.j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc_i1 ON pgboss.j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc_i2 ON pgboss.j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc_i3 ON pgboss.j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc_i4 ON pgboss.j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc_i5 ON pgboss.j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55_i1 ON pgboss.j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55_i2 ON pgboss.j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55_i3 ON pgboss.j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55_i4 ON pgboss.j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55_i5 ON pgboss.j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i1 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i2 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i3 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i4 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i5 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971_i1 ON pgboss.j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971_i2 ON pgboss.j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971_i3 ON pgboss.j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971_i4 ON pgboss.j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971_i5 ON pgboss.j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1_i1 ON pgboss.j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1_i2 ON pgboss.j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1_i3 ON pgboss.j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1_i4 ON pgboss.j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1_i5 ON pgboss.j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c_i1 ON pgboss.j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c_i2 ON pgboss.j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c_i3 ON pgboss.j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c_i4 ON pgboss.j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c_i5 ON pgboss.j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481_i1 ON pgboss.j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481_i2 ON pgboss.j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481_i3 ON pgboss.j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481_i4 ON pgboss.j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481_i5 ON pgboss.j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3_i1 ON pgboss.j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3_i2 ON pgboss.j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3_i3 ON pgboss.j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3_i4 ON pgboss.j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3_i5 ON pgboss.j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6_i1 ON pgboss.j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6_i2 ON pgboss.j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6_i3 ON pgboss.j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6_i4 ON pgboss.j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6_i5 ON pgboss.j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf_i1 ON pgboss.j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf_i2 ON pgboss.j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf_i3 ON pgboss.j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf_i4 ON pgboss.j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf_i5 ON pgboss.j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63_i1 ON pgboss.ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63_i2 ON pgboss.ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63_i3 ON pgboss.ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63_i4 ON pgboss.ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63_i5 ON pgboss.ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d_i1 ON pgboss.jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d_i2 ON pgboss.jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d_i3 ON pgboss.jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d_i4 ON pgboss.jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d_i5 ON pgboss.jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6_i1 ON pgboss.jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6_i2 ON pgboss.jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6_i3 ON pgboss.jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6_i4 ON pgboss.jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6_i5 ON pgboss.jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3_i1 ON pgboss.jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3_i2 ON pgboss.jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3_i3 ON pgboss.jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3_i4 ON pgboss.jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3_i5 ON pgboss.jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce_i1 ON pgboss.jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce_i2 ON pgboss.jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce_i3 ON pgboss.jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce_i4 ON pgboss.jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce_i5 ON pgboss.jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291_i1 ON pgboss.jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291_i2 ON pgboss.jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291_i3 ON pgboss.jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291_i4 ON pgboss.jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291_i5 ON pgboss.jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb_i1 ON pgboss.jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb_i2 ON pgboss.jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb_i3 ON pgboss.jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb_i4 ON pgboss.jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb_i5 ON pgboss.jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5_i1 ON pgboss.jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5_i2 ON pgboss.jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5_i3 ON pgboss.jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5_i4 ON pgboss.jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5_i5 ON pgboss.jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821_i1 ON pgboss.jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821_i2 ON pgboss.jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821_i3 ON pgboss.jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821_i4 ON pgboss.jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821_i5 ON pgboss.jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd_i1 ON pgboss.jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd_i2 ON pgboss.jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd_i3 ON pgboss.jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd_i4 ON pgboss.jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd_i5 ON pgboss.jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8_i1 ON pgboss.jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8_i2 ON pgboss.jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8_i3 ON pgboss.jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8_i4 ON pgboss.jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8_i5 ON pgboss.jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026_i1 ON pgboss.jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026_i2 ON pgboss.jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026_i3 ON pgboss.jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026_i4 ON pgboss.jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026_i5 ON pgboss.jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87_i1 ON pgboss.je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87_i2 ON pgboss.je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87_i3 ON pgboss.je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87_i4 ON pgboss.je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87_i5 ON pgboss.je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250_i1 ON pgboss.je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250_i2 ON pgboss.je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250_i3 ON pgboss.je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250_i4 ON pgboss.je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250_i5 ON pgboss.je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce_i1 ON pgboss.jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce_i2 ON pgboss.jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce_i3 ON pgboss.jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce_i4 ON pgboss.jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce_i5 ON pgboss.jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8_i1 ON pgboss.jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8_i2 ON pgboss.jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8_i3 ON pgboss.jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8_i4 ON pgboss.jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8_i5 ON pgboss.jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219_i1 ON pgboss.jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219_i2 ON pgboss.jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219_i3 ON pgboss.jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219_i4 ON pgboss.jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219_i5 ON pgboss.jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c_i1 ON pgboss.jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c_i2 ON pgboss.jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c_i3 ON pgboss.jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c_i4 ON pgboss.jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c_i5 ON pgboss.jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886_i1 ON pgboss.jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886_i2 ON pgboss.jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886_i3 ON pgboss.jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886_i4 ON pgboss.jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886_i5 ON pgboss.jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0_i1 ON pgboss.jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0_i2 ON pgboss.jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0_i3 ON pgboss.jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0_i4 ON pgboss.jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0_i5 ON pgboss.jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: account_invitations_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_invitations_created_idx ON public.account_invitations USING btree (created_at DESC);


--
-- Name: account_invitations_pending_email_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX account_invitations_pending_email_uidx ON public.account_invitations USING btree (lower(email)) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));


--
-- Name: account_invitations_token_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX account_invitations_token_uidx ON public.account_invitations USING btree (token_hash);


--
-- Name: admin_audit_log_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_log_created_idx ON public.admin_audit_log USING btree (created_at DESC);


--
-- Name: admin_audit_log_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_log_org_idx ON public.admin_audit_log USING btree (target_org_id);


--
-- Name: agent_logs_agent_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_logs_agent_created_idx ON public.agent_logs USING btree (agent, created_at DESC);


--
-- Name: agent_logs_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_logs_agent_idx ON public.agent_logs USING btree (agent);


--
-- Name: agent_logs_opp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_logs_opp_idx ON public.agent_logs USING btree (opportunity_id);


--
-- Name: agent_logs_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_logs_time_idx ON public.agent_logs USING btree (created_at DESC);


--
-- Name: analytics_events_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_event_idx ON public.analytics_events USING btree (event, created_at DESC);


--
-- Name: analytics_events_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_org_idx ON public.analytics_events USING btree (org_id, created_at DESC);


--
-- Name: automation_incidents_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX automation_incidents_open_idx ON public.automation_incidents USING btree (org_id, cause) WHERE (state <> 'recovered'::text);


--
-- Name: automation_incidents_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_incidents_org_idx ON public.automation_incidents USING btree (org_id, started_at DESC);


--
-- Name: backlink_outreach_approval_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX backlink_outreach_approval_idx ON public.backlink_outreach USING btree (approval_status);


--
-- Name: backlink_outreach_send_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX backlink_outreach_send_idx ON public.backlink_outreach USING btree (approval_status, sent_at);


--
-- Name: backlink_prospects_priority_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX backlink_prospects_priority_idx ON public.backlink_prospects USING btree (priority_score DESC);


--
-- Name: backlink_prospects_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX backlink_prospects_status_idx ON public.backlink_prospects USING btree (status);


--
-- Name: backlinks_lost_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX backlinks_lost_idx ON public.backlinks USING btree (lost_at);


--
-- Name: bid_calc_snapshot_bid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bid_calc_snapshot_bid_idx ON public.bid_calculation_snapshots USING btree (bid_id, taken_at DESC);


--
-- Name: bid_overrides_bid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bid_overrides_bid_idx ON public.bid_overrides USING btree (bid_id, created_at);


--
-- Name: bid_overrides_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bid_overrides_org_idx ON public.bid_overrides USING btree (org_id, created_at DESC);


--
-- Name: bid_submission_events_bid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bid_submission_events_bid_idx ON public.bid_submission_events USING btree (bid_id, created_at);


--
-- Name: bids_awaiting_receipt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bids_awaiting_receipt_idx ON public.bids USING btree (org_id, submitted_at) WHERE (submission_state = 'sent'::text);


--
-- Name: bids_one_per_opportunity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bids_one_per_opportunity ON public.bids USING btree (opportunity_id);


--
-- Name: bids_opp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bids_opp_idx ON public.bids USING btree (opportunity_id);


--
-- Name: bids_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bids_org_idx ON public.bids USING btree (org_id);


--
-- Name: bids_outcome_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bids_outcome_idx ON public.bids USING btree (outcome);


--
-- Name: billing_invoices_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_invoices_org_idx ON public.billing_invoices USING btree (org_id, issued_at DESC NULLS LAST);


--
-- Name: call_cards_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_cards_org_idx ON public.call_cards USING btree (org_id, status);


--
-- Name: call_cards_pending_opp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_cards_pending_opp_idx ON public.call_cards USING btree (status, opportunity_id) WHERE (status = 'pending'::text);


--
-- Name: call_cards_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_cards_source_idx ON public.call_cards USING btree (source);


--
-- Name: call_cards_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_cards_status_idx ON public.call_cards USING btree (status);


--
-- Name: commission_events_influencer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commission_events_influencer_idx ON public.commission_events USING btree (influencer_id, occurred_at DESC);


--
-- Name: commission_events_invoice_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX commission_events_invoice_uniq ON public.commission_events USING btree (stripe_invoice_id, kind) WHERE (stripe_invoice_id IS NOT NULL);


--
-- Name: commission_events_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commission_events_pending_idx ON public.commission_events USING btree (influencer_id) WHERE (payout_id IS NULL);


--
-- Name: commission_events_refund_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX commission_events_refund_uniq ON public.commission_events USING btree (stripe_refund_id) WHERE (stripe_refund_id IS NOT NULL);


--
-- Name: communications_delivery_attention_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX communications_delivery_attention_idx ON public.communications USING btree (org_id, delivery_state, created_at DESC) WHERE (delivery_state = ANY (ARRAY['bounced'::text, 'deferred'::text, 'failed'::text]));


--
-- Name: communications_followup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX communications_followup_idx ON public.communications USING btree (follow_up_at) WHERE ((follow_up_at IS NOT NULL) AND (replied_at IS NULL));


--
-- Name: communications_inbound_message_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX communications_inbound_message_uniq ON public.communications USING btree (gmail_message_id) WHERE ((direction = 'inbound'::text) AND (gmail_message_id IS NOT NULL));


--
-- Name: communications_opp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX communications_opp_idx ON public.communications USING btree (opportunity_id);


--
-- Name: communications_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX communications_org_idx ON public.communications USING btree (org_id);


--
-- Name: communications_rfc822_message_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX communications_rfc822_message_id_idx ON public.communications USING btree (rfc822_message_id) WHERE (rfc822_message_id IS NOT NULL);


--
-- Name: communications_sub_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX communications_sub_idx ON public.communications USING btree (subcontractor_id);


--
-- Name: communications_sub_opp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX communications_sub_opp_idx ON public.communications USING btree (subcontractor_id, opportunity_id, created_at DESC);


--
-- Name: communications_track_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX communications_track_idx ON public.communications USING btree (tracking_id);


--
-- Name: company_profile_active_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX company_profile_active_uidx ON public.company_profile USING btree (org_id) WHERE is_active;


--
-- Name: company_profile_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX company_profile_org_idx ON public.company_profile USING btree (org_id, is_active);


--
-- Name: company_profile_version_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX company_profile_version_uidx ON public.company_profile USING btree (org_id, version);


--
-- Name: compliance_item_documents_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_item_documents_item_idx ON public.compliance_item_documents USING btree (item_id, uploaded_at DESC);


--
-- Name: compliance_item_events_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_item_events_item_idx ON public.compliance_item_events USING btree (item_id, created_at DESC);


--
-- Name: compliance_items_assigned_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_items_assigned_to_idx ON public.compliance_items USING btree (org_id, assigned_to) WHERE (assigned_to IS NOT NULL);


--
-- Name: compliance_items_cat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_items_cat_idx ON public.compliance_items USING btree (category);


--
-- Name: compliance_items_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_items_due_idx ON public.compliance_items USING btree (due_at);


--
-- Name: compliance_items_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_items_source_idx ON public.compliance_items USING btree (source);


--
-- Name: content_library_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_library_active_idx ON public.content_library USING btree (is_active);


--
-- Name: content_library_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_library_category_idx ON public.content_library USING btree (category);


--
-- Name: content_library_tags_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_library_tags_idx ON public.content_library USING gin (tags);


--
-- Name: contract_coordination_contract_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contract_coordination_contract_idx ON public.contract_coordination USING btree (contract_id, happened_at DESC);


--
-- Name: contract_invoices_contract_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contract_invoices_contract_idx ON public.contract_invoices USING btree (contract_id, COALESCE(submitted_at, created_at) DESC);


--
-- Name: contract_invoices_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX contract_invoices_number_idx ON public.contract_invoices USING btree (contract_id, lower(btrim(invoice_number)));


--
-- Name: contract_issues_contract_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contract_issues_contract_idx ON public.contract_issues USING btree (contract_id, ((resolved_at IS NULL)) DESC, raised_at DESC);


--
-- Name: contract_milestones_contract_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contract_milestones_contract_idx ON public.contract_milestones USING btree (contract_id, sort_order, due_at);


--
-- Name: contract_modifications_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX contract_modifications_number_idx ON public.contract_modifications USING btree (contract_id, lower(btrim(mod_number)));


--
-- Name: contracts_assigned_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contracts_assigned_to_idx ON public.contracts USING btree (org_id, assigned_to) WHERE (assigned_to IS NOT NULL);


--
-- Name: contracts_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contracts_status_idx ON public.contracts USING btree (status);


--
-- Name: conversation_flags_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_flags_open_idx ON public.conversation_flags USING btree (org_id) WHERE (resolved_at IS NULL);


--
-- Name: custom_kpis_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX custom_kpis_sort_idx ON public.custom_kpis USING btree (sort_order, created_at);


--
-- Name: documents_content_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_content_hash_idx ON public.documents USING btree (opportunity_id, content_hash) WHERE (content_hash IS NOT NULL);


--
-- Name: documents_inventory_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_inventory_idx ON public.documents USING btree (opportunity_id, document_class, amendment_number);


--
-- Name: documents_opp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_opp_idx ON public.documents USING btree (opportunity_id);


--
-- Name: documents_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_org_idx ON public.documents USING btree (org_id);


--
-- Name: documents_requirement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_requirement_idx ON public.documents USING btree (opportunity_id, requirement_id) WHERE (requirement_id IS NOT NULL);


--
-- Name: documents_superseded_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_superseded_idx ON public.documents USING btree (superseded_by) WHERE (superseded_by IS NOT NULL);


--
-- Name: documents_unresolved_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_unresolved_idx ON public.documents USING btree (org_id, opportunity_id) WHERE ((disposition <> 'delivered'::text) OR (extraction_state <> 'extracted'::text));


--
-- Name: email_suppressions_org_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX email_suppressions_org_email_idx ON public.email_suppressions USING btree (org_id, lower(email));


--
-- Name: feedback_reports_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feedback_reports_org_idx ON public.feedback_reports USING btree (org_id, created_at DESC);


--
-- Name: incident_events_incident_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX incident_events_incident_idx ON public.incident_events USING btree (incident_id, created_at);


--
-- Name: incident_requeues_incident_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX incident_requeues_incident_idx ON public.incident_requeues USING btree (incident_id, outcome);


--
-- Name: incident_requeues_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX incident_requeues_key_idx ON public.incident_requeues USING btree (idempotency_key);


--
-- Name: influencer_codes_code_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX influencer_codes_code_uniq ON public.influencer_codes USING btree (upper(code));


--
-- Name: influencer_codes_influencer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX influencer_codes_influencer_idx ON public.influencer_codes USING btree (influencer_id);


--
-- Name: influencer_codes_promo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX influencer_codes_promo_idx ON public.influencer_codes USING btree (stripe_promotion_code_id);


--
-- Name: influencer_payouts_influencer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX influencer_payouts_influencer_idx ON public.influencer_payouts USING btree (influencer_id, period_end DESC);


--
-- Name: influencer_payouts_period_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX influencer_payouts_period_uniq ON public.influencer_payouts USING btree (influencer_id, period_start, period_end);


--
-- Name: influencer_payouts_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX influencer_payouts_status_idx ON public.influencer_payouts USING btree (status);


--
-- Name: influencers_email_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX influencers_email_uniq ON public.influencers USING btree (lower(email));


--
-- Name: influencers_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX influencers_status_idx ON public.influencers USING btree (status);


--
-- Name: integration_settings_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX integration_settings_org_idx ON public.integration_settings USING btree (org_id);


--
-- Name: integration_tokens_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX integration_tokens_org_idx ON public.integration_tokens USING btree (org_id, provider);


--
-- Name: job_runs_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_runs_agent_idx ON public.job_runs USING btree (agent, started_at DESC);


--
-- Name: job_runs_agent_record_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_runs_agent_record_idx ON public.job_runs USING btree (agent, opportunity_id, started_at) WHERE (opportunity_id IS NOT NULL);


--
-- Name: job_runs_org_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_runs_org_agent_idx ON public.job_runs USING btree (org_id, agent, started_at DESC) WHERE (org_id IS NOT NULL);


--
-- Name: job_runs_recovery_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_runs_recovery_idx ON public.job_runs USING btree (org_id, status, started_at) WHERE (status = 'error'::text);


--
-- Name: opportunities_assigned_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunities_assigned_to_idx ON public.opportunities USING btree (org_id, assigned_to) WHERE (assigned_to IS NOT NULL);


--
-- Name: opportunities_deadline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunities_deadline_idx ON public.opportunities USING btree (deadline);


--
-- Name: opportunities_naics_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunities_naics_idx ON public.opportunities USING btree (naics_code);


--
-- Name: opportunities_open_deadline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunities_open_deadline_idx ON public.opportunities USING btree (deadline) WHERE (status = 'open'::text);


--
-- Name: opportunities_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunities_org_idx ON public.opportunities USING btree (org_id, stage, status);


--
-- Name: opportunities_org_solnum_open_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX opportunities_org_solnum_open_uniq ON public.opportunities USING btree (org_id, lower(btrim(solicitation_number))) WHERE ((status = 'open'::text) AND (solicitation_number IS NOT NULL) AND (btrim(solicitation_number) <> ''::text));


--
-- Name: opportunities_org_source_id_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX opportunities_org_source_id_uniq ON public.opportunities USING btree (org_id, source_id) WHERE (source_id IS NOT NULL);


--
-- Name: opportunities_pursuit_stopped_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunities_pursuit_stopped_idx ON public.opportunities USING btree (org_id, pursuit_state) WHERE (pursuit_state <> 'active'::text);


--
-- Name: opportunities_review_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunities_review_expiry_idx ON public.opportunities USING btree (org_id, review_expires_at) WHERE ((tier = 'review'::text) AND (human_action_required = true) AND (review_expires_at IS NOT NULL));


--
-- Name: opportunities_snoozed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunities_snoozed_idx ON public.opportunities USING btree (snoozed_until) WHERE (snoozed_until IS NOT NULL);


--
-- Name: opportunities_ss_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunities_ss_idx ON public.opportunities USING btree (is_sources_sought) WHERE is_sources_sought;


--
-- Name: opportunities_stage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunities_stage_idx ON public.opportunities USING btree (stage);


--
-- Name: opportunities_tier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunities_tier_idx ON public.opportunities USING btree (tier);


--
-- Name: opportunity_subs_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunity_subs_active_idx ON public.opportunity_subs USING btree (opportunity_id) WHERE (removed_at IS NULL);


--
-- Name: opportunity_subs_one_primary_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX opportunity_subs_one_primary_idx ON public.opportunity_subs USING btree (opportunity_id, COALESCE(trade, ''::text)) WHERE ((role = 'primary'::text) AND (removed_at IS NULL));


--
-- Name: opportunity_subs_opp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunity_subs_opp_idx ON public.opportunity_subs USING btree (opportunity_id);


--
-- Name: opportunity_subs_quote_timing_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunity_subs_quote_timing_idx ON public.opportunity_subs USING btree (subcontractor_id) WHERE (quote_due_at IS NOT NULL);


--
-- Name: opportunity_subs_sub_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunity_subs_sub_idx ON public.opportunity_subs USING btree (subcontractor_id);


--
-- Name: organization_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_members_user_idx ON public.organization_members USING btree (user_id);


--
-- Name: organizations_deletion_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organizations_deletion_due_idx ON public.organizations USING btree (deletion_scheduled_at) WHERE (deletion_scheduled_at IS NOT NULL);


--
-- Name: organizations_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organizations_status_idx ON public.organizations USING btree (subscription_status);


--
-- Name: organizations_stripe_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organizations_stripe_customer_idx ON public.organizations USING btree (stripe_customer_id);


--
-- Name: organizations_stripe_customer_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX organizations_stripe_customer_uniq ON public.organizations USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);


--
-- Name: organizations_stripe_subscription_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX organizations_stripe_subscription_uniq ON public.organizations USING btree (stripe_subscription_id) WHERE (stripe_subscription_id IS NOT NULL);


--
-- Name: outreach_suppressions_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outreach_suppressions_lookup_idx ON public.outreach_suppressions USING btree (org_id, subcontractor_id) WHERE (lifted_at IS NULL);


--
-- Name: outreach_suppressions_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outreach_suppressions_org_idx ON public.outreach_suppressions USING btree (org_id, created_at DESC);


--
-- Name: password_reset_tokens_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX password_reset_tokens_user_idx ON public.password_reset_tokens USING btree (user_id);


--
-- Name: platform_key_grants_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_key_grants_key_idx ON public.platform_key_grants USING btree (env_key);


--
-- Name: platform_key_usage_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_key_usage_key_idx ON public.platform_key_usage USING btree (env_key);


--
-- Name: pricing_comps_opp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pricing_comps_opp_idx ON public.pricing_comps USING btree (opportunity_id);


--
-- Name: quotes_opp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotes_opp_idx ON public.quotes USING btree (opportunity_id);


--
-- Name: quotes_opp_sub_trade_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quotes_opp_sub_trade_uniq ON public.quotes USING btree (opportunity_id, subcontractor_id, COALESCE(trade, ''::text));


--
-- Name: quotes_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotes_org_idx ON public.quotes USING btree (org_id);


--
-- Name: quotes_sub_opp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotes_sub_opp_idx ON public.quotes USING btree (subcontractor_id, opportunity_id, created_at DESC);


--
-- Name: recap_deliveries_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX recap_deliveries_once_idx ON public.recap_deliveries USING btree (COALESCE(org_id, '00000000-0000-4000-8000-000000000000'::uuid), lower(recipient_email), local_date, scope) WHERE (test = false);


--
-- Name: recap_deliveries_org_day_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recap_deliveries_org_day_idx ON public.recap_deliveries USING btree (org_id, local_date DESC);


--
-- Name: recap_deliveries_recipient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recap_deliveries_recipient_idx ON public.recap_deliveries USING btree (lower(recipient_email), sent_at DESC);


--
-- Name: recap_deliveries_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recap_deliveries_status_idx ON public.recap_deliveries USING btree (status, sent_at DESC);


--
-- Name: recap_urgent_items_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recap_urgent_items_seen_idx ON public.recap_urgent_items USING btree (org_id, last_seen_on DESC);


--
-- Name: referral_attributions_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_attributions_customer_idx ON public.referral_attributions USING btree (stripe_customer_id);


--
-- Name: referral_attributions_influencer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX referral_attributions_influencer_idx ON public.referral_attributions USING btree (influencer_id);


--
-- Name: reply_drafts_sub_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reply_drafts_sub_idx ON public.reply_drafts USING btree (subcontractor_id);


--
-- Name: requirement_state_events_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX requirement_state_events_lookup_idx ON public.requirement_state_events USING btree (opportunity_id, requirement_id, at DESC);


--
-- Name: requirement_states_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX requirement_states_due_idx ON public.requirement_states USING btree (org_id, due_at) WHERE (due_at IS NOT NULL);


--
-- Name: requirement_states_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX requirement_states_owner_idx ON public.requirement_states USING btree (org_id, owner_id) WHERE (owner_id IS NOT NULL);


--
-- Name: sam_daily_calls_day_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sam_daily_calls_day_idx ON public.sam_daily_calls USING btree (day);


--
-- Name: saved_views_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saved_views_lookup_idx ON public.saved_views USING btree (org_id, page_key);


--
-- Name: saved_views_personal_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX saved_views_personal_name_idx ON public.saved_views USING btree (org_id, owner_id, page_key, lower(name)) WHERE (scope = 'personal'::text);


--
-- Name: saved_views_team_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX saved_views_team_name_idx ON public.saved_views USING btree (org_id, page_key, lower(name)) WHERE (scope = 'team'::text);


--
-- Name: scoring_weights_active_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX scoring_weights_active_uidx ON public.scoring_weights USING btree (org_id) WHERE is_active;


--
-- Name: sessions_impersonator_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_impersonator_idx ON public.sessions USING btree (impersonator_user_id) WHERE (impersonator_user_id IS NOT NULL);


--
-- Name: sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_idx ON public.sessions USING btree (user_id);


--
-- Name: solicitation_verifications_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX solicitation_verifications_live_idx ON public.solicitation_verifications USING btree (idempotency_key) WHERE (state = ANY (ARRAY['queued'::text, 'in_progress'::text]));


--
-- Name: solicitation_verifications_opp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solicitation_verifications_opp_idx ON public.solicitation_verifications USING btree (opportunity_id, queued_at DESC);


--
-- Name: solicitation_verifications_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX solicitation_verifications_org_idx ON public.solicitation_verifications USING btree (org_id, queued_at DESC);


--
-- Name: stripe_events_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stripe_events_org_idx ON public.stripe_events USING btree (org_id, created_at DESC);


--
-- Name: stripe_events_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stripe_events_type_idx ON public.stripe_events USING btree (type);


--
-- Name: sub_documents_current_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sub_documents_current_uniq ON public.subcontractor_documents USING btree (subcontractor_id, doc_type) WHERE (status = ANY (ARRAY['pending'::text, 'active'::text, 'expiring'::text]));


--
-- Name: sub_documents_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sub_documents_expiry_idx ON public.subcontractor_documents USING btree (expires_at) WHERE ((expires_at IS NOT NULL) AND (status <> 'rejected'::text));


--
-- Name: sub_documents_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sub_documents_org_idx ON public.subcontractor_documents USING btree (org_id);


--
-- Name: sub_documents_sub_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sub_documents_sub_idx ON public.subcontractor_documents USING btree (subcontractor_id, doc_type);


--
-- Name: sub_documents_w9_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sub_documents_w9_idx ON public.subcontractor_documents USING btree (subcontractor_id) WHERE (doc_type = 'w9'::text);


--
-- Name: sub_payments_org_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sub_payments_org_year_idx ON public.subcontractor_payments USING btree (org_id, tax_year);


--
-- Name: sub_payments_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sub_payments_year_idx ON public.subcontractor_payments USING btree (subcontractor_id, tax_year);


--
-- Name: sub_performance_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sub_performance_live_idx ON public.subcontractor_performance_events USING btree (subcontractor_id) WHERE (retracted_at IS NULL);


--
-- Name: sub_performance_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sub_performance_lookup_idx ON public.subcontractor_performance_events USING btree (org_id, subcontractor_id, at DESC);


--
-- Name: sub_reply_events_message_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sub_reply_events_message_uniq ON public.subcontractor_reply_events USING btree (gmail_message_id) WHERE (gmail_message_id IS NOT NULL);


--
-- Name: sub_reply_events_opp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sub_reply_events_opp_idx ON public.subcontractor_reply_events USING btree (opportunity_id);


--
-- Name: sub_reply_events_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sub_reply_events_review_idx ON public.subcontractor_reply_events USING btree (needs_review) WHERE (needs_review AND (reviewed_at IS NULL));


--
-- Name: sub_reply_events_sub_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sub_reply_events_sub_idx ON public.subcontractor_reply_events USING btree (subcontractor_id, created_at DESC);


--
-- Name: subcontractor_bulk_actions_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subcontractor_bulk_actions_org_idx ON public.subcontractor_bulk_actions USING btree (org_id, created_at DESC);


--
-- Name: subcontractor_contacts_one_primary_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX subcontractor_contacts_one_primary_idx ON public.subcontractor_contacts USING btree (subcontractor_id) WHERE (is_primary = true);


--
-- Name: subcontractor_contacts_sub_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subcontractor_contacts_sub_idx ON public.subcontractor_contacts USING btree (subcontractor_id);


--
-- Name: subcontractor_licenses_sub_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subcontractor_licenses_sub_idx ON public.subcontractor_licenses USING btree (subcontractor_id);


--
-- Name: subcontractor_licenses_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX subcontractor_licenses_unique_idx ON public.subcontractor_licenses USING btree (subcontractor_id, lower(trade), COALESCE(lower(jurisdiction), ''::text));


--
-- Name: subcontractor_merges_merged_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subcontractor_merges_merged_idx ON public.subcontractor_merges USING btree (merged_id);


--
-- Name: subcontractor_merges_survivor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subcontractor_merges_survivor_idx ON public.subcontractor_merges USING btree (org_id, survivor_id, at DESC);


--
-- Name: subcontractor_tags_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subcontractor_tags_lookup_idx ON public.subcontractor_tags USING btree (org_id, lower(tag));


--
-- Name: subcontractor_tags_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX subcontractor_tags_unique_idx ON public.subcontractor_tags USING btree (subcontractor_id, lower(tag));


--
-- Name: subcontractors_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subcontractors_active_idx ON public.subcontractors USING btree (org_id) WHERE (archived_at IS NULL);


--
-- Name: subcontractors_assigned_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subcontractors_assigned_to_idx ON public.subcontractors USING btree (org_id, assigned_to) WHERE (assigned_to IS NOT NULL);


--
-- Name: subcontractors_blacklisted_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subcontractors_blacklisted_idx ON public.subcontractors USING btree (org_id) WHERE (blacklisted = true);


--
-- Name: subcontractors_merged_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subcontractors_merged_idx ON public.subcontractors USING btree (merged_into) WHERE (merged_into IS NOT NULL);


--
-- Name: subcontractors_naics_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subcontractors_naics_idx ON public.subcontractors USING gin (naics_codes);


--
-- Name: subcontractors_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subcontractors_org_idx ON public.subcontractors USING btree (org_id);


--
-- Name: subcontractors_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subcontractors_state_idx ON public.subcontractors USING btree (state);


--
-- Name: subcontractors_trades_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subcontractors_trades_idx ON public.subcontractors USING gin (trade_categories);


--
-- Name: templates_one_draft_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX templates_one_draft_uidx ON public.templates USING btree (org_id, slug) WHERE (status = 'draft'::text);


--
-- Name: templates_org_slug_version_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX templates_org_slug_version_uniq ON public.templates USING btree (org_id, slug, version);


--
-- Name: trade_pricing_opp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trade_pricing_opp_idx ON public.trade_pricing_rows USING btree (opportunity_id);


--
-- Name: trade_pricing_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trade_pricing_org_idx ON public.trade_pricing_rows USING btree (org_id);


--
-- Name: unmatched_inbound_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX unmatched_inbound_message_idx ON public.unmatched_inbound USING btree (org_id, message_id) WHERE (message_id IS NOT NULL);


--
-- Name: unmatched_inbound_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unmatched_inbound_queue_idx ON public.unmatched_inbound USING btree (org_id, received_at) WHERE (state = 'needs_matching'::text);


--
-- Name: user_email_aliases_email_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_email_aliases_email_uidx ON public.user_email_aliases USING btree (lower(email));


--
-- Name: user_email_aliases_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_email_aliases_user_idx ON public.user_email_aliases USING btree (user_id);


--
-- Name: j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98_pkey;


--
-- Name: j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7_pkey;


--
-- Name: j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1_pkey;


--
-- Name: j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd_pkey;


--
-- Name: j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc_pkey;


--
-- Name: j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688_pkey;


--
-- Name: j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc_pkey;


--
-- Name: j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55_pkey;


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_pkey;


--
-- Name: j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971_pkey;


--
-- Name: j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1_pkey;


--
-- Name: j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c_pkey;


--
-- Name: j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481_pkey;


--
-- Name: j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3_pkey;


--
-- Name: j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6_pkey;


--
-- Name: j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf_pkey;


--
-- Name: ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63_pkey;


--
-- Name: jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d_pkey;


--
-- Name: jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6_pkey;


--
-- Name: jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3_pkey;


--
-- Name: jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce_pkey;


--
-- Name: jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291_pkey;


--
-- Name: jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb_pkey;


--
-- Name: jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5_pkey;


--
-- Name: jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821_pkey;


--
-- Name: jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd_pkey;


--
-- Name: jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8_pkey;


--
-- Name: jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026_pkey;


--
-- Name: je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87_pkey;


--
-- Name: je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250_pkey;


--
-- Name: jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce_pkey;


--
-- Name: jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8_pkey;


--
-- Name: jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219_pkey;


--
-- Name: jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c_pkey;


--
-- Name: jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886_pkey;


--
-- Name: jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0_pkey;


--
-- Name: agent_logs agent_logs_derive_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER agent_logs_derive_org BEFORE INSERT ON public.agent_logs FOR EACH ROW EXECUTE FUNCTION public.derive_org_for_agent_log();


--
-- Name: user_email_aliases aliases_email_unused; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER aliases_email_unused BEFORE INSERT OR UPDATE OF email ON public.user_email_aliases FOR EACH ROW EXECUTE FUNCTION public.assert_login_email_unused();


--
-- Name: bid_calculation_snapshots bid_calculation_snapshots_immutable_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bid_calculation_snapshots_immutable_trg BEFORE DELETE OR UPDATE ON public.bid_calculation_snapshots FOR EACH ROW EXECUTE FUNCTION public.bid_calculation_snapshots_immutable();


--
-- Name: bids bids_derive_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bids_derive_org BEFORE INSERT ON public.bids FOR EACH ROW EXECUTE FUNCTION public.derive_org_from_opportunity();


--
-- Name: call_cards call_cards_derive_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER call_cards_derive_org BEFORE INSERT ON public.call_cards FOR EACH ROW EXECUTE FUNCTION public.derive_org_from_opportunity();


--
-- Name: communications communications_derive_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER communications_derive_org BEFORE INSERT ON public.communications FOR EACH ROW EXECUTE FUNCTION public.derive_org_for_communication();


--
-- Name: compliance_item_events compliance_event_immutable_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER compliance_event_immutable_trg BEFORE DELETE OR UPDATE ON public.compliance_item_events FOR EACH ROW EXECUTE FUNCTION public.compliance_event_immutable();


--
-- Name: compliance_items compliance_items_assignee_member; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER compliance_items_assignee_member BEFORE INSERT OR UPDATE OF assigned_to, assigned_by ON public.compliance_items FOR EACH ROW EXECUTE FUNCTION public.assigned_to_must_be_member();


--
-- Name: contracts contracts_assignee_member; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER contracts_assignee_member BEFORE INSERT OR UPDATE OF assigned_to, assigned_by ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.assigned_to_must_be_member();


--
-- Name: contracts contracts_derive_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER contracts_derive_org BEFORE INSERT ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.derive_org_from_opportunity();


--
-- Name: documents documents_derive_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER documents_derive_org BEFORE INSERT ON public.documents FOR EACH ROW EXECUTE FUNCTION public.derive_org_from_opportunity();


--
-- Name: opportunities opportunities_assignee_member; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER opportunities_assignee_member BEFORE INSERT OR UPDATE OF assigned_to, assigned_by ON public.opportunities FOR EACH ROW EXECUTE FUNCTION public.assigned_to_must_be_member();


--
-- Name: pricing_comps pricing_comps_derive_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER pricing_comps_derive_org BEFORE INSERT ON public.pricing_comps FOR EACH ROW EXECUTE FUNCTION public.derive_org_from_opportunity();


--
-- Name: quotes quotes_derive_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER quotes_derive_org BEFORE INSERT ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.derive_org_from_opportunity();


--
-- Name: requirement_state_events requirement_state_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER requirement_state_events_append_only BEFORE DELETE OR UPDATE ON public.requirement_state_events FOR EACH ROW EXECUTE FUNCTION public.requirement_state_events_immutable();


--
-- Name: subcontractor_documents subcontractor_documents_derive_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER subcontractor_documents_derive_org BEFORE INSERT ON public.subcontractor_documents FOR EACH ROW EXECUTE FUNCTION public.derive_org_from_subcontractor();


--
-- Name: subcontractor_payments subcontractor_payments_derive_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER subcontractor_payments_derive_org BEFORE INSERT ON public.subcontractor_payments FOR EACH ROW EXECUTE FUNCTION public.derive_org_from_subcontractor();


--
-- Name: subcontractors subcontractors_assignee_member; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER subcontractors_assignee_member BEFORE INSERT OR UPDATE OF assigned_to, assigned_by ON public.subcontractors FOR EACH ROW EXECUTE FUNCTION public.assigned_to_must_be_member();


--
-- Name: bids trg_touch_bids; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_bids BEFORE UPDATE ON public.bids FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: compliance_items trg_touch_compliance_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_compliance_items BEFORE UPDATE ON public.compliance_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: contracts trg_touch_contracts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_contracts BEFORE UPDATE ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: opportunities trg_touch_opportunities; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_opportunities BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: subcontractors trg_touch_subcontractors; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_subcontractors BEFORE UPDATE ON public.subcontractors FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: users users_email_unused; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_email_unused BEFORE INSERT OR UPDATE OF email ON public.users FOR EACH ROW EXECUTE FUNCTION public.assert_login_email_unused();


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jd505f0974028eb9f2bd5cc27dcb6583dff1c17d67472ee1873e00821
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j36776195c5c6cf3b225b22d3f706d42f0f042717d85aef5aef037688
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jf5e5142e156b21872d6b54c3886af3d4426179c9cdcf3c853a400e4c
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jbf099b59b52c9f1465dbc0584efe40772265c124fdacaaddaeca68f3
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j3c122b802223e9640618ccaff5d0027fca2262e4b6d063a5fa302b55
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j4493945fcf0b8e41e31009f49ef49d82f5475a60234bc20d1bc8b971
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j39e799b1ff0f6ec06c1b681e444140b8bd24f1716988eb041cd164dc
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jc84957d37163575103486fa14186da8c54950d344dbc52c3df79c291
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jfb33ccbbaea509a7a411d841af93fe2a5cfb761dc198828f93a3b8c0
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j019a934e236de36566d346855c5a7d551be95c69133fc2f4ab434d98
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jc6c63b54809c2f16a5a4834e95333a227e8b7327558c3fd0b64d96ce
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j148b4a8abf419fa71ef82ece6ce483767444f9b7f656f64ce8452ce1
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j5464ddf6238eb56ae39b6a10e0e0672fef699baf5bcb57e20bc36f4c
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jf4bcba99f399ff77601ee8b9ff526cf478b0571d0f77f3ace26f6219
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.ja2be4a77fad6e0aed4b6ba4a7d1cd7d056f177d8f8c0a4e57b604f63
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j348339623aeef24c4afbb33a5216d66ba6cd321944e6b9fea29e6cfd
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jd8dcfa48a50a66083a62f39961d83a5426c838679523545f7d1a4afd
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jab941e3c8947a4304169f4e8b667b279f3fa9807596567cef26ab15d
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.je56aedb941532a082009512a7d275a112887d8fed69eec4aeb318250
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jb30a26f70db72a4ec8a5d37a30ee17200a927f148e5a44859355c9e6
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.je5488d16dadfb0833f4f605bc6d058829b5ff495955e9b97b25c0b87
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j8f955e37239817600450aa8b5a7064ccb13df15684989443db23e8bf
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j548a4e1268e52122ce9ba8ee689e089127f1f51a5c6975a584b50481
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jda72a8909935c2a0a2ec3ea0cb9318f9ef1dc9d707c84ea3307587e8
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jed7b8a08c46b2dcbf54bdea6aa146da7633459d765ae77f517aa54ce
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jf6c99fb94e6a3a65f48368515d57f3e3cdb0a6aa9bc9523b27a07886
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j358916ced5fd281883eec9671d26b1764713952fc9d4241c40335ffc
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jee5f93a4b715cdb167e511585cc45326f45de1396cd0f9592672eda8
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j8f20814f069b3fbeb9503a101993b2177329168ba52e378cb3be1cc6
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jdd075eb9710547e33c59ab8ea795dcb155d67680cc449ab2d7229026
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j4defbfb24e8bfafee2318be48cceae3edfe44638bc289358e9a4eaf1
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jd4b5f69d59f6e3cd936951214d4bcad8084836b47e10912a08d28dc5
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jc93a4a199f6eb4b5085f8f26c7ceb36ff2ac1301406a8e4b59f2b4cb
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j0b4a7c779d2fc117f8b4c0700782bb3a159404539934b5b3f07fb0e7
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j6b24b91c37566b2ec6ec4b1c880527883ef34d319402e0a134db03c3
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: queue queue_dead_letter_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.queue
    ADD CONSTRAINT queue_dead_letter_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name);


--
-- Name: schedule schedule_name_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.schedule
    ADD CONSTRAINT schedule_name_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE CASCADE;


--
-- Name: subscription subscription_name_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.subscription
    ADD CONSTRAINT subscription_name_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE CASCADE;


--
-- Name: account_invitations account_invitations_accepted_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_invitations
    ADD CONSTRAINT account_invitations_accepted_user_id_fkey FOREIGN KEY (accepted_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: account_invitations account_invitations_invited_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_invitations
    ADD CONSTRAINT account_invitations_invited_by_user_id_fkey FOREIGN KEY (invited_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: agent_logs agent_logs_bid_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_logs
    ADD CONSTRAINT agent_logs_bid_id_fkey FOREIGN KEY (bid_id) REFERENCES public.bids(id) ON DELETE SET NULL;


--
-- Name: agent_logs agent_logs_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_logs
    ADD CONSTRAINT agent_logs_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: agent_logs agent_logs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_logs
    ADD CONSTRAINT agent_logs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: agent_logs agent_logs_subcontractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_logs
    ADD CONSTRAINT agent_logs_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE SET NULL;


--
-- Name: analytics_events analytics_events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: analytics_events analytics_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: authority_snapshots authority_snapshots_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authority_snapshots
    ADD CONSTRAINT authority_snapshots_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: automation_incidents automation_incidents_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_incidents
    ADD CONSTRAINT automation_incidents_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: backlink_competitors backlink_competitors_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backlink_competitors
    ADD CONSTRAINT backlink_competitors_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: backlink_outreach backlink_outreach_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backlink_outreach
    ADD CONSTRAINT backlink_outreach_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: backlink_outreach backlink_outreach_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backlink_outreach
    ADD CONSTRAINT backlink_outreach_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.backlink_prospects(id) ON DELETE CASCADE;


--
-- Name: backlink_prospects backlink_prospects_competitor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backlink_prospects
    ADD CONSTRAINT backlink_prospects_competitor_id_fkey FOREIGN KEY (competitor_id) REFERENCES public.backlink_competitors(id) ON DELETE SET NULL;


--
-- Name: backlink_prospects backlink_prospects_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backlink_prospects
    ADD CONSTRAINT backlink_prospects_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: backlinks backlinks_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backlinks
    ADD CONSTRAINT backlinks_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: backlinks backlinks_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backlinks
    ADD CONSTRAINT backlinks_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.backlink_prospects(id) ON DELETE SET NULL;


--
-- Name: bid_calculation_snapshots bid_calculation_snapshots_bid_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bid_calculation_snapshots
    ADD CONSTRAINT bid_calculation_snapshots_bid_id_fkey FOREIGN KEY (bid_id) REFERENCES public.bids(id) ON DELETE CASCADE;


--
-- Name: bid_calculation_snapshots bid_calculation_snapshots_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bid_calculation_snapshots
    ADD CONSTRAINT bid_calculation_snapshots_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: bid_calculation_snapshots bid_calculation_snapshots_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bid_calculation_snapshots
    ADD CONSTRAINT bid_calculation_snapshots_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: bid_overrides bid_overrides_bid_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bid_overrides
    ADD CONSTRAINT bid_overrides_bid_id_fkey FOREIGN KEY (bid_id) REFERENCES public.bids(id) ON DELETE CASCADE;


--
-- Name: bid_overrides bid_overrides_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bid_overrides
    ADD CONSTRAINT bid_overrides_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: bid_submission_events bid_submission_events_bid_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bid_submission_events
    ADD CONSTRAINT bid_submission_events_bid_id_fkey FOREIGN KEY (bid_id) REFERENCES public.bids(id) ON DELETE CASCADE;


--
-- Name: bid_submission_events bid_submission_events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bid_submission_events
    ADD CONSTRAINT bid_submission_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: bids bids_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bids
    ADD CONSTRAINT bids_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: bids bids_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bids
    ADD CONSTRAINT bids_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: bids bids_proof_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bids
    ADD CONSTRAINT bids_proof_document_id_fkey FOREIGN KEY (proof_document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


--
-- Name: billing_invoices billing_invoices_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_invoices
    ADD CONSTRAINT billing_invoices_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: call_cards call_cards_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_cards
    ADD CONSTRAINT call_cards_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: call_cards call_cards_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_cards
    ADD CONSTRAINT call_cards_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: call_cards call_cards_subcontractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_cards
    ADD CONSTRAINT call_cards_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE CASCADE;


--
-- Name: commission_events commission_events_attribution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_events
    ADD CONSTRAINT commission_events_attribution_id_fkey FOREIGN KEY (attribution_id) REFERENCES public.referral_attributions(id) ON DELETE CASCADE;


--
-- Name: commission_events commission_events_influencer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_events
    ADD CONSTRAINT commission_events_influencer_id_fkey FOREIGN KEY (influencer_id) REFERENCES public.influencers(id);


--
-- Name: commission_events commission_events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_events
    ADD CONSTRAINT commission_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: commission_events commission_events_payout_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_events
    ADD CONSTRAINT commission_events_payout_fk FOREIGN KEY (payout_id) REFERENCES public.influencer_payouts(id) ON DELETE SET NULL;


--
-- Name: communications communications_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: communications communications_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: communications communications_subcontractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE CASCADE;


--
-- Name: company_profile company_profile_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_profile
    ADD CONSTRAINT company_profile_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: compliance_item_documents compliance_item_documents_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_item_documents
    ADD CONSTRAINT compliance_item_documents_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.compliance_items(id) ON DELETE CASCADE;


--
-- Name: compliance_item_documents compliance_item_documents_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_item_documents
    ADD CONSTRAINT compliance_item_documents_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: compliance_item_documents compliance_item_documents_superseded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_item_documents
    ADD CONSTRAINT compliance_item_documents_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.compliance_item_documents(id) ON DELETE SET NULL;


--
-- Name: compliance_item_documents compliance_item_documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_item_documents
    ADD CONSTRAINT compliance_item_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: compliance_item_events compliance_item_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_item_events
    ADD CONSTRAINT compliance_item_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: compliance_item_events compliance_item_events_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_item_events
    ADD CONSTRAINT compliance_item_events_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.compliance_items(id) ON DELETE CASCADE;


--
-- Name: compliance_item_events compliance_item_events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_item_events
    ADD CONSTRAINT compliance_item_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: compliance_items compliance_items_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_items
    ADD CONSTRAINT compliance_items_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: compliance_items compliance_items_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_items
    ADD CONSTRAINT compliance_items_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: compliance_items compliance_items_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_items
    ADD CONSTRAINT compliance_items_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: compliance_items compliance_items_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_items
    ADD CONSTRAINT compliance_items_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: compliance_items compliance_items_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_items
    ADD CONSTRAINT compliance_items_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: content_library content_library_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_library
    ADD CONSTRAINT content_library_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: contract_coordination contract_coordination_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_coordination
    ADD CONSTRAINT contract_coordination_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contract_coordination contract_coordination_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_coordination
    ADD CONSTRAINT contract_coordination_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: contract_coordination contract_coordination_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_coordination
    ADD CONSTRAINT contract_coordination_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: contract_coordination contract_coordination_subcontractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_coordination
    ADD CONSTRAINT contract_coordination_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE SET NULL;


--
-- Name: contract_invoices contract_invoices_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_invoices
    ADD CONSTRAINT contract_invoices_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contract_invoices contract_invoices_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_invoices
    ADD CONSTRAINT contract_invoices_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: contract_issues contract_issues_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_issues
    ADD CONSTRAINT contract_issues_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contract_issues contract_issues_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_issues
    ADD CONSTRAINT contract_issues_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: contract_issues contract_issues_raised_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_issues
    ADD CONSTRAINT contract_issues_raised_by_fkey FOREIGN KEY (raised_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: contract_milestones contract_milestones_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_milestones
    ADD CONSTRAINT contract_milestones_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: contract_milestones contract_milestones_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_milestones
    ADD CONSTRAINT contract_milestones_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contract_milestones contract_milestones_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_milestones
    ADD CONSTRAINT contract_milestones_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: contract_modifications contract_modifications_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_modifications
    ADD CONSTRAINT contract_modifications_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contract_modifications contract_modifications_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_modifications
    ADD CONSTRAINT contract_modifications_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: contract_modifications contract_modifications_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_modifications
    ADD CONSTRAINT contract_modifications_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: contract_modifications contract_modifications_superseded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_modifications
    ADD CONSTRAINT contract_modifications_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.contract_modifications(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_backup_sub_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_backup_sub_id_fkey FOREIGN KEY (backup_sub_id) REFERENCES public.subcontractors(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_bid_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_bid_id_fkey FOREIGN KEY (bid_id) REFERENCES public.bids(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: contracts contracts_primary_sub_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_primary_sub_id_fkey FOREIGN KEY (primary_sub_id) REFERENCES public.subcontractors(id) ON DELETE SET NULL;


--
-- Name: conversation_flags conversation_flags_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_flags
    ADD CONSTRAINT conversation_flags_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: conversation_flags conversation_flags_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_flags
    ADD CONSTRAINT conversation_flags_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id);


--
-- Name: custom_kpis custom_kpis_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_kpis
    ADD CONSTRAINT custom_kpis_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: documents documents_bid_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_bid_id_fkey FOREIGN KEY (bid_id) REFERENCES public.bids(id) ON DELETE CASCADE;


--
-- Name: documents documents_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: documents documents_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: documents documents_superseded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.documents(id) ON DELETE SET NULL;


--
-- Name: email_suppressions email_suppressions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_suppressions
    ADD CONSTRAINT email_suppressions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: feedback_reports feedback_reports_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_reports
    ADD CONSTRAINT feedback_reports_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: feedback_reports feedback_reports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_reports
    ADD CONSTRAINT feedback_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: file_blobs file_blobs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_blobs
    ADD CONSTRAINT file_blobs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: incident_events incident_events_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_events
    ADD CONSTRAINT incident_events_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.automation_incidents(id) ON DELETE CASCADE;


--
-- Name: incident_events incident_events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_events
    ADD CONSTRAINT incident_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: incident_requeues incident_requeues_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_requeues
    ADD CONSTRAINT incident_requeues_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.automation_incidents(id) ON DELETE CASCADE;


--
-- Name: incident_requeues incident_requeues_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_requeues
    ADD CONSTRAINT incident_requeues_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: influencer_codes influencer_codes_influencer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.influencer_codes
    ADD CONSTRAINT influencer_codes_influencer_id_fkey FOREIGN KEY (influencer_id) REFERENCES public.influencers(id) ON DELETE CASCADE;


--
-- Name: influencer_payouts influencer_payouts_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.influencer_payouts
    ADD CONSTRAINT influencer_payouts_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: influencer_payouts influencer_payouts_influencer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.influencer_payouts
    ADD CONSTRAINT influencer_payouts_influencer_id_fkey FOREIGN KEY (influencer_id) REFERENCES public.influencers(id);


--
-- Name: integration_settings integration_settings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_settings
    ADD CONSTRAINT integration_settings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: integration_tokens integration_tokens_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_tokens
    ADD CONSTRAINT integration_tokens_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: job_runs job_runs_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: job_runs job_runs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: opportunities opportunities_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: opportunities opportunities_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: opportunities opportunities_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: opportunity_subs opportunity_subs_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_subs
    ADD CONSTRAINT opportunity_subs_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: opportunity_subs opportunity_subs_removed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_subs
    ADD CONSTRAINT opportunity_subs_removed_by_fkey FOREIGN KEY (removed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: opportunity_subs opportunity_subs_replaced_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_subs
    ADD CONSTRAINT opportunity_subs_replaced_by_fkey FOREIGN KEY (replaced_by) REFERENCES public.opportunity_subs(id) ON DELETE SET NULL;


--
-- Name: opportunity_subs opportunity_subs_subcontractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_subs
    ADD CONSTRAINT opportunity_subs_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE CASCADE;


--
-- Name: organization_members organization_members_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_members organization_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: outreach_suppressions outreach_suppressions_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_suppressions
    ADD CONSTRAINT outreach_suppressions_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: outreach_suppressions outreach_suppressions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_suppressions
    ADD CONSTRAINT outreach_suppressions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: outreach_suppressions outreach_suppressions_subcontractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_suppressions
    ADD CONSTRAINT outreach_suppressions_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE CASCADE;


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: platform_key_grants platform_key_grants_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_key_grants
    ADD CONSTRAINT platform_key_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id);


--
-- Name: platform_key_grants platform_key_grants_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_key_grants
    ADD CONSTRAINT platform_key_grants_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: platform_key_usage platform_key_usage_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_key_usage
    ADD CONSTRAINT platform_key_usage_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: pricing_comps pricing_comps_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_comps
    ADD CONSTRAINT pricing_comps_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: pricing_comps pricing_comps_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_comps
    ADD CONSTRAINT pricing_comps_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: quotes quotes_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: quotes quotes_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: quotes quotes_subcontractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE SET NULL;


--
-- Name: recap_deliveries recap_deliveries_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recap_deliveries
    ADD CONSTRAINT recap_deliveries_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: recap_deliveries recap_deliveries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recap_deliveries
    ADD CONSTRAINT recap_deliveries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: recap_urgent_items recap_urgent_items_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recap_urgent_items
    ADD CONSTRAINT recap_urgent_items_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: referral_attributions referral_attributions_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_attributions
    ADD CONSTRAINT referral_attributions_code_id_fkey FOREIGN KEY (code_id) REFERENCES public.influencer_codes(id);


--
-- Name: referral_attributions referral_attributions_influencer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_attributions
    ADD CONSTRAINT referral_attributions_influencer_id_fkey FOREIGN KEY (influencer_id) REFERENCES public.influencers(id);


--
-- Name: referral_attributions referral_attributions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_attributions
    ADD CONSTRAINT referral_attributions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: reply_drafts reply_drafts_communication_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reply_drafts
    ADD CONSTRAINT reply_drafts_communication_id_fkey FOREIGN KEY (communication_id) REFERENCES public.communications(id) ON DELETE CASCADE;


--
-- Name: reply_drafts reply_drafts_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reply_drafts
    ADD CONSTRAINT reply_drafts_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: reply_drafts reply_drafts_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reply_drafts
    ADD CONSTRAINT reply_drafts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: reply_drafts reply_drafts_subcontractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reply_drafts
    ADD CONSTRAINT reply_drafts_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE SET NULL;


--
-- Name: requirement_state_events requirement_state_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirement_state_events
    ADD CONSTRAINT requirement_state_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: requirement_state_events requirement_state_events_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirement_state_events
    ADD CONSTRAINT requirement_state_events_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: requirement_state_events requirement_state_events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirement_state_events
    ADD CONSTRAINT requirement_state_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: requirement_states requirement_states_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirement_states
    ADD CONSTRAINT requirement_states_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: requirement_states requirement_states_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirement_states
    ADD CONSTRAINT requirement_states_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: requirement_states requirement_states_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirement_states
    ADD CONSTRAINT requirement_states_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: requirement_states requirement_states_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirement_states
    ADD CONSTRAINT requirement_states_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sam_daily_calls sam_daily_calls_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sam_daily_calls
    ADD CONSTRAINT sam_daily_calls_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: saved_views saved_views_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_views
    ADD CONSTRAINT saved_views_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: saved_views saved_views_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_views
    ADD CONSTRAINT saved_views_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: saved_views saved_views_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_views
    ADD CONSTRAINT saved_views_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: scoring_weights scoring_weights_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_weights
    ADD CONSTRAINT scoring_weights_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: sessions sessions_impersonator_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_impersonator_user_id_fkey FOREIGN KEY (impersonator_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: solicitation_verifications solicitation_verifications_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitation_verifications
    ADD CONSTRAINT solicitation_verifications_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: solicitation_verifications solicitation_verifications_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitation_verifications
    ADD CONSTRAINT solicitation_verifications_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: stripe_events stripe_events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_events
    ADD CONSTRAINT stripe_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: subcontractor_bulk_actions subcontractor_bulk_actions_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_bulk_actions
    ADD CONSTRAINT subcontractor_bulk_actions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: subcontractor_bulk_actions subcontractor_bulk_actions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_bulk_actions
    ADD CONSTRAINT subcontractor_bulk_actions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: subcontractor_bulk_actions subcontractor_bulk_actions_undone_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_bulk_actions
    ADD CONSTRAINT subcontractor_bulk_actions_undone_by_fkey FOREIGN KEY (undone_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: subcontractor_contacts subcontractor_contacts_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_contacts
    ADD CONSTRAINT subcontractor_contacts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: subcontractor_contacts subcontractor_contacts_subcontractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_contacts
    ADD CONSTRAINT subcontractor_contacts_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE CASCADE;


--
-- Name: subcontractor_documents subcontractor_documents_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_documents
    ADD CONSTRAINT subcontractor_documents_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: subcontractor_documents subcontractor_documents_subcontractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_documents
    ADD CONSTRAINT subcontractor_documents_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE CASCADE;


--
-- Name: subcontractor_documents subcontractor_documents_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_documents
    ADD CONSTRAINT subcontractor_documents_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id);


--
-- Name: subcontractor_licenses subcontractor_licenses_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_licenses
    ADD CONSTRAINT subcontractor_licenses_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: subcontractor_licenses subcontractor_licenses_subcontractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_licenses
    ADD CONSTRAINT subcontractor_licenses_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE CASCADE;


--
-- Name: subcontractor_merges subcontractor_merges_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_merges
    ADD CONSTRAINT subcontractor_merges_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: subcontractor_merges subcontractor_merges_merged_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_merges
    ADD CONSTRAINT subcontractor_merges_merged_id_fkey FOREIGN KEY (merged_id) REFERENCES public.subcontractors(id) ON DELETE CASCADE;


--
-- Name: subcontractor_merges subcontractor_merges_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_merges
    ADD CONSTRAINT subcontractor_merges_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: subcontractor_merges subcontractor_merges_survivor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_merges
    ADD CONSTRAINT subcontractor_merges_survivor_id_fkey FOREIGN KEY (survivor_id) REFERENCES public.subcontractors(id) ON DELETE CASCADE;


--
-- Name: subcontractor_merges subcontractor_merges_undone_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_merges
    ADD CONSTRAINT subcontractor_merges_undone_by_fkey FOREIGN KEY (undone_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: subcontractor_payments subcontractor_payments_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_payments
    ADD CONSTRAINT subcontractor_payments_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: subcontractor_payments subcontractor_payments_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_payments
    ADD CONSTRAINT subcontractor_payments_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: subcontractor_payments subcontractor_payments_subcontractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_payments
    ADD CONSTRAINT subcontractor_payments_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE CASCADE;


--
-- Name: subcontractor_performance_events subcontractor_performance_events_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_performance_events
    ADD CONSTRAINT subcontractor_performance_events_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: subcontractor_performance_events subcontractor_performance_events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_performance_events
    ADD CONSTRAINT subcontractor_performance_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: subcontractor_performance_events subcontractor_performance_events_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_performance_events
    ADD CONSTRAINT subcontractor_performance_events_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: subcontractor_performance_events subcontractor_performance_events_retracted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_performance_events
    ADD CONSTRAINT subcontractor_performance_events_retracted_by_fkey FOREIGN KEY (retracted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: subcontractor_performance_events subcontractor_performance_events_subcontractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_performance_events
    ADD CONSTRAINT subcontractor_performance_events_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE CASCADE;


--
-- Name: subcontractor_reply_events subcontractor_reply_events_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_reply_events
    ADD CONSTRAINT subcontractor_reply_events_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: subcontractor_reply_events subcontractor_reply_events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_reply_events
    ADD CONSTRAINT subcontractor_reply_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: subcontractor_reply_events subcontractor_reply_events_subcontractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_reply_events
    ADD CONSTRAINT subcontractor_reply_events_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE CASCADE;


--
-- Name: subcontractor_tags subcontractor_tags_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_tags
    ADD CONSTRAINT subcontractor_tags_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: subcontractor_tags subcontractor_tags_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_tags
    ADD CONSTRAINT subcontractor_tags_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: subcontractor_tags subcontractor_tags_subcontractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractor_tags
    ADD CONSTRAINT subcontractor_tags_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE CASCADE;


--
-- Name: subcontractors subcontractors_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractors
    ADD CONSTRAINT subcontractors_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: subcontractors subcontractors_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractors
    ADD CONSTRAINT subcontractors_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: subcontractors subcontractors_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractors
    ADD CONSTRAINT subcontractors_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: subcontractors subcontractors_blacklisted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractors
    ADD CONSTRAINT subcontractors_blacklisted_by_fkey FOREIGN KEY (blacklisted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: subcontractors subcontractors_capability_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractors
    ADD CONSTRAINT subcontractors_capability_updated_by_fkey FOREIGN KEY (capability_updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: subcontractors subcontractors_merged_into_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractors
    ADD CONSTRAINT subcontractors_merged_into_fkey FOREIGN KEY (merged_into) REFERENCES public.subcontractors(id) ON DELETE SET NULL;


--
-- Name: subcontractors subcontractors_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcontractors
    ADD CONSTRAINT subcontractors_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: templates templates_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: trade_pricing_rows trade_pricing_rows_backup_sub_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_pricing_rows
    ADD CONSTRAINT trade_pricing_rows_backup_sub_id_fkey FOREIGN KEY (backup_sub_id) REFERENCES public.subcontractors(id) ON DELETE SET NULL;


--
-- Name: trade_pricing_rows trade_pricing_rows_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_pricing_rows
    ADD CONSTRAINT trade_pricing_rows_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: trade_pricing_rows trade_pricing_rows_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_pricing_rows
    ADD CONSTRAINT trade_pricing_rows_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: trade_pricing_rows trade_pricing_rows_selected_sub_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_pricing_rows
    ADD CONSTRAINT trade_pricing_rows_selected_sub_id_fkey FOREIGN KEY (selected_sub_id) REFERENCES public.subcontractors(id) ON DELETE SET NULL;


--
-- Name: trade_pricing_rows trade_pricing_rows_source_quote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_pricing_rows
    ADD CONSTRAINT trade_pricing_rows_source_quote_id_fkey FOREIGN KEY (source_quote_id) REFERENCES public.quotes(id) ON DELETE SET NULL;


--
-- Name: trade_pricing_rows trade_pricing_rows_supporting_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_pricing_rows
    ADD CONSTRAINT trade_pricing_rows_supporting_document_id_fkey FOREIGN KEY (supporting_document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


--
-- Name: unmatched_inbound unmatched_inbound_matched_communication_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unmatched_inbound
    ADD CONSTRAINT unmatched_inbound_matched_communication_id_fkey FOREIGN KEY (matched_communication_id) REFERENCES public.communications(id) ON DELETE SET NULL;


--
-- Name: unmatched_inbound unmatched_inbound_matched_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unmatched_inbound
    ADD CONSTRAINT unmatched_inbound_matched_opportunity_id_fkey FOREIGN KEY (matched_opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: unmatched_inbound unmatched_inbound_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unmatched_inbound
    ADD CONSTRAINT unmatched_inbound_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: unmatched_inbound unmatched_inbound_subcontractor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unmatched_inbound
    ADD CONSTRAINT unmatched_inbound_subcontractor_id_fkey FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE SET NULL;


--
-- Name: user_email_aliases user_email_aliases_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_email_aliases
    ADD CONSTRAINT user_email_aliases_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: _migrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public._migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: authority_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.authority_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: backlink_competitors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.backlink_competitors ENABLE ROW LEVEL SECURITY;

--
-- Name: backlink_outreach; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.backlink_outreach ENABLE ROW LEVEL SECURITY;

--
-- Name: backlink_prospects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.backlink_prospects ENABLE ROW LEVEL SECURITY;

--
-- Name: backlinks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.backlinks ENABLE ROW LEVEL SECURITY;

--
-- Name: bids; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;

--
-- Name: call_cards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.call_cards ENABLE ROW LEVEL SECURITY;

--
-- Name: communications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.communications ENABLE ROW LEVEL SECURITY;

--
-- Name: company_profile; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.company_profile ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_items ENABLE ROW LEVEL SECURITY;

--
-- Name: content_library; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_library ENABLE ROW LEVEL SECURITY;

--
-- Name: contracts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

--
-- Name: custom_kpis; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.custom_kpis ENABLE ROW LEVEL SECURITY;

--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: file_blobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.file_blobs ENABLE ROW LEVEL SECURITY;

--
-- Name: integration_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integration_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: job_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: opportunities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

--
-- Name: opportunity_subs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.opportunity_subs ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: password_reset_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: pricing_comps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pricing_comps ENABLE ROW LEVEL SECURITY;

--
-- Name: quotes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

--
-- Name: recap_deliveries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recap_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: recap_urgent_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recap_urgent_items ENABLE ROW LEVEL SECURITY;

--
-- Name: scoring_weights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scoring_weights ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: subcontractors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subcontractors ENABLE ROW LEVEL SECURITY;

--
-- Name: templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: worker_heartbeat; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.worker_heartbeat ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict gYntmaNvlUnHEruDNqMgx1yXtozQtJZdsNYnrhMalkmANLYJZxG7e2m7RZ4qa40

