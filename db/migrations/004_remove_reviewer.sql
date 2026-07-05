-- 004: remove the temporary platform-review login. The owner's operator
-- account is provisioned from OPERATOR_EMAIL/OPERATOR_PASSWORD secrets at
-- worker boot (lib/operator-bootstrap.ts), so this account is no longer needed.
delete from sessions where user_id in (select id from users where lower(email) = 'reviewer@webiq.co');
delete from users where lower(email) = 'reviewer@webiq.co';
