---
name: Row-level actions on lists
description: Rules for offering an action on a list row: match the endpoint's capability and its payload, and keep controls out of the row's anchor.
---

## A row's action must match its endpoint on both counts

An action offered on a row has to agree with the API twice: on who may run it,
and on what the request must carry.

- **Capability.** Gate the row on the capability the route actually requires,
  not on the one whose name sounds right. Guessing from the name hid re-runs
  from team members whose role the endpoint accepts.
- **Payload.** An action whose endpoint requires a structured reason cannot be
  reduced to a yes/no dialog. It has to open the real control. A confirmation
  that collects agreement and sends nothing produces a button that fails on
  every click.

**Why:** both failures look identical to the operator: a product that offers
something and then refuses it. Hiding a permitted action reads as broken, and
a permitted action that 400s reads as broken.

**How to apply:** when adding a row action, open the route handler, read the
capability it requires and the body it validates, and match both. When the body
needs more than an id, hand off to the control the record page already uses
rather than writing a thinner second copy.

## Controls never live inside the row's anchor

Several lists make the whole row a link. Put the controls beside the link, not
inside it. A button in an `<a>` navigates as well as acting, and the navigation
cancels the request the button just sent; a link inside a link is invalid and
the browser drops one of them.

The click-swallowing wrapper is not a fix. It calls `preventDefault`, which is
right for a button inside a card link and fatal for an action that is itself a
link: those render, get clicked, and do nothing.

**Why:** the wrapper made the nesting appear to work, so the nesting spread,
and the first link-shaped action added afterwards was silently dead.

**How to apply:** restructure the row so the anchor is a sibling of the
controls. Where the whole card should stay clickable, the anchor covers the
facts and the controls sit in a footer row.
