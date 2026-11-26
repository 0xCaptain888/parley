# Cloud Wallet Keyring Acceptance

This addon restricts the pinned wallet CLI. It does not enable transactions,
change the vendor's installed source, or provide independent security approval.

## Threat Boundary

GNOME keyring protects a password-encrypted file while locked. While unlocked,
the Agent Unix account and root can access the Secret Service. Host root, a
compromised kernel, swap, crash dumps and provider administrators remain trust
boundaries. Do not run an unrestricted model/shell runtime under this account
while the wallet is unlocked. Passwords are entered privately, never stored in
argv, environment, a configuration file or a chat message. Disabling core dumps
in the setup shell does not establish system-wide memory/swap protection.

The existing provider relay key and future Telegram token are private files,
not protected by this wallet keyring. Do not describe those as encrypted.

## Install

Verify the public archive SHA-256 and every SHA256SUMS entry before:

```sh
sudo bash install-wallet-security.sh --approve-readonly-security-addon
```

No service, keyring, wallet session or transaction is created by installation.
The addon is placed in a new root-owned directory; existing code is untouched.

## Private Operator Setup

Start the dedicated account's existing distribution user manager, user D-Bus
and keyring units. Do not enable lingering, automatic unlock or a login password.
The daemon and user bus are not a business Agent.

Run `enter-keyring.sh --approve-new-encrypted-keyring-and-synthetic-test` under
the dedicated account with a clean HOME/PATH and private user bus environment.
Only a new keyring is accepted; an existing login.keyring is never overwritten.
The operator privately enters a new password twice, minimum 16 characters.

The helper creates/unlocks the login keyring using the daemon's stdin interface,
requires the private owned GNOME binary-format file header, and writes a unique
random synthetic item. Only a digest is retained in private runtime storage.
It verifies locking, rejection of a deliberately wrong password, successful
unlock with the operator password, synthetic persistence and removal. Failure
leaves any test state for review; never automatically delete an existing keyring.
This is a scoped functional acceptance, not a cryptographic/security audit.
It does not verify restart/reboot recovery. Loss of the password prevents future
unlock. After a reboot the operator must unlock privately again.

For an existing locked keyring, use
`unlock-keyring.sh --approve-existing-keyring-private-unlock` in the same private
account/bus environment. It checks the existing encrypted file and locked
collection before prompting, unlocks once through stdin, then checks the
unlocked state. A wrong password fails closed; there is no reset or automatic
retry. This is a recovery entrypoint, not evidence that reboot recovery passed.

## Guarded Wallet Commands

`wallet-secure.mjs` accepts only exact Skill/CLI checks, wallet status/settings/
address, BSC transaction-lock inspection, signin and verify commands. It refuses transfers, contract calls and
other arguments. Its stdout whitelist omits sessionId/clientId/token fields.
Pairing code and pairing URL are public login artifacts shown verbatim to the
operator. No raw CLI stdout or stderr is printed.

`wallet-preflight.mjs` runs the documented ordered skill/CLI/status/settings/
address/lock inspection through this guarded entrypoint. It stops before
settings if disconnected and never initiates login or updates software.
Its sanitized report covers session expiry, Developer Mode and quotas, not
real business-method acceptance. Nested settings/address output is allowlisted.

Before every invocation it requires a private Unix bus, unlocked collection,
GNOME binary-format keyring and no file-backed sessionId. It pins the installed
1.12.0 CLI entrypoint SHA-256. The preload checks the login collection before
each native operation and terminates the child on native failure before the
vendor CLI can catch the failure and fall back to file storage. This protection
only applies through the guarded entrypoint, not to direct `baw` execution.
Existing default keytar getPassword calls are part of official authentication;
their secret results are never printed or exposed to a model.

No daemon/gateway/model execution, contract deployment, approval, transfer or
other signing command is permitted by this addon. Formal business trading still
requires agreed parameters, review, a canonical deployed/verified contract and
individual transaction previews and approvals.
