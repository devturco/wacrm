-- ============================================================
-- The COMPANY NAME at signup.
--
-- `accounts.name` is the name of the company — today it is filled
-- with the person's own name (migration 017), which made it useless
-- for anything that identifies the company: the CRMBR instances are
-- named `<company>_<instance>` on the provider side, so the company
-- name has to be the real one.
--
-- The signup form now asks for it and sends it as user metadata; this
-- migration makes the bootstrap trigger prefer it.
--
-- The fallback chain is unchanged for the paths that have no company
-- name (a member leaving an account, an old account created before
-- this migration): the person's name, then the e-mail, then a
-- constant. Nothing breaks, and the company name can be corrected
-- later in Settings → Profile.
-- ============================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_company_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_company_name := COALESCE(NEW.raw_user_meta_data->>'company_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (
    COALESCE(
      NULLIF(v_company_name, ''),
      NULLIF(v_full_name, ''),
      NEW.email,
      'My account'
    ),
    NEW.id
  )
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
