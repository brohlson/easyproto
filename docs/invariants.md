# Product invariants

These are intended requirements. Evidence is collected during implementation; none is represented as already demonstrated by this starter.

| ID | Invariant | Accountable lead |
| --- | --- | --- |
| INV-01 | Mockup content cannot acquire privileged IPC, arbitrary filesystem, process, or application-navigation authority | Security |
| INV-02 | All committed document mutations use the same serialized command service | Architecture/Reliability |
| INV-03 | A stale mutation cannot silently overwrite a newer committed revision | Architecture/Reliability |
| INV-04 | Retrying a committed logical command within the supported deduplication contract returns its original outcome without a second mutation | Architecture/Reliability |
| INV-05 | Recovery yields an intact prior/new committed revision or an explicit recoverable state; no mixed revision is presented as successfully saved | Architecture/Reliability |
| INV-06 | Every screenshot identifies the requested source revision, viewport, and rendering context, or reports it cannot do so | Frontend + Architecture/Reliability |
| INV-07 | Camera zoom preserves CSS viewport size; artboard resize changes it intentionally | Frontend |
| INV-08 | Supported project sources and assets are portable; preview/import/export operations cannot escape authorized roots | Security + Architecture/Reliability |
| INV-09 | Unsupported schemas never silently downgrade; migration preserves a recoverable original | Architecture/Reliability + Infrastructure |
| INV-10 | Keyboard focus and escape behavior preserve access to the canvas when entering/exiting a preview | Design + Frontend |
| INV-11 | A supported packaged build can execute the core agent-to-canvas workflow and reopen saved work | Infrastructure |
| INV-12 | A published snapshot contains only selected revision content and needed assets, never local credentials or private application state | Security + Infrastructure |
| INV-13 | Review evidence and verdicts refer to the revision being accepted; missing evidence cannot be represented as a passed check | Infrastructure + Architecture/Reliability |

Add an invariant only when its consequence matters to the product. Add a regression fixture after a relevant defect; avoid replacing clear behavior requirements with broad coverage percentages.

