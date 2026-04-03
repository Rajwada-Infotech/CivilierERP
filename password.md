# CivilierERP — Password Reference

## How passwords are stored

All passwords in this application are hashed using **bcrypt** (cost factor 10 for
the frontend demo store, cost factor 12 for the backend SQL database). bcrypt is a
one-way hashing algorithm — the original password **cannot be mathematically
reversed** from the hash.

## How login works

1. The user enters their plaintext password in the login form.
2. The app calls `bcrypt.compareSync(enteredPassword, storedHash)`.
3. bcrypt internally re-runs the same hashing process and compares the results.
4. If they match → login succeeds. The original password is never stored or transmitted.

## Demo user credentials (frontend AuthContext)

These are the **original** plaintext passwords for the built-in demo accounts.
Keep this file out of version control in production.

| Role        | Email                       | Password   |
|-------------|-----------------------------|------------|
| Super Admin | superadmin@civilier.com     | super123   |
| Admin       | admin@civilier.com          | admin123   |
| DBA         | dba@civilier.com            | dba123     |
| User        | rajesh@civilier.com         | user123    |
| User        | meena@civilier.com          | user123    |
| User        | dinesh@civilier.com         | user123    |

## Recovering / resetting a forgotten password

Because bcrypt is one-way, **you cannot "decrypt" a hash back to a password**.
The correct recovery flow is:

### For demo / development users (AuthContext)
1. Open `src/contexts/AuthContext.tsx`.
2. Generate a new hash: `node -e "const b=require('bcryptjs'); console.log(b.hashSync('yourNewPassword',10))"`.
3. Replace the `password` field for that user with the new hash.

### For production users (SQL database)
1. Log in as a **Super Admin** or **Admin**.
2. Go to **Admin → Security → Password Reset**.
3. Select the user and issue a new temporary password — the backend will hash it
   automatically via `bcrypt.hash(newPassword, 12)` before writing to the database.

### For the SQL `sa` / DB credentials (backend `.env`)
These are not hashed — they are connection credentials stored in `.env` which is
excluded from version control via `.gitignore`. Never commit `.env` to git.
Contact your DBA or infrastructure team to rotate these credentials.

## bcrypt library reference

| Layer    | Library     | Usage                                      |
|----------|-------------|--------------------------------------------|
| Frontend | `bcryptjs`  | `bcrypt.compareSync(plain, hash)` in login |
|          |             | `bcrypt.hashSync(plain, 10)` in addUser    |
| Backend  | `bcrypt`    | `bcrypt.compare(plain, hash)` async        |
|          |             | `bcrypt.hash(plain, 12)` async             |
