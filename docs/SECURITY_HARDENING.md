---
summary: Local security posture and operating rules for the Zotero MCP plugin.
read_when:
  - Hardening the MCP HTTP server
  - Reviewing write-tool exposure
  - Building or installing the Zotero MCP XPI
---

# Security Hardening

This plugin exposes a local MCP HTTP server for Zotero. Treat it as sensitive
because it can read library metadata, notes, annotations, full text, and local
attachment paths. When write operations are enabled, it can also create or
modify Zotero items, collections, notes, tags, and attachments.

## Hardened Defaults

- `mcp.server.allowRemote` defaults to `false` and is reset to `false` on plugin
  startup; the server should bind only to loopback unless a user deliberately
  enables remote access for the current session.
- `write.enabled` defaults to `false` and is reset to `false` on plugin startup;
  mutating tools are hidden from `tools/list` and rejected at call time unless
  the user deliberately enables write operations in Zotero preferences.
- The MCP server has no authentication. Only use it from trusted local clients
  and avoid leaving it enabled while browsing untrusted sites or running
  untrusted local code.

## Verification

After starting Zotero, verify that the listener is loopback-only:

```bash
lsof -nP -iTCP:23120 -sTCP:LISTEN
```

The address should be `127.0.0.1:23120`, not `*:23120` or `0.0.0.0:23120`.

Check that write tools are disabled by default with `tools/list`; the list
should not contain collection mutation tools or `write_*` tools until
`write.enabled` is set to `true`.

## Attachment Import

The maintained source includes the patched `write_item` attachment actions:

- `attach_file`: imports a local file through Zotero's attachment API.
- `attach_url`: imports an accessible URL through Zotero's attachment API.
- `trash_attachment`: moves an existing Zotero attachment to Zotero trash after
  validating the attachment key and optional parent item key.

These actions remain gated by `write.enabled`. Prefer publisher, open-access,
institutional, author-hosted, course-hosted, or user-owned PDFs, and verify that
downloaded content is a real PDF before calling attachment actions.

## Repository Hygiene

Do not commit task reports containing absolute Zotero storage paths, personal
e-mail addresses, API keys, cookies, or downloaded PDFs. Keep task-specific
reports outside this source repository unless they have been reviewed and
redacted.
