# Telegram settings

Run `ORCA_BACKGROUND_LAUNCH=1 node tests/tools/telegram-settings-rendered/run.mjs`.

The probe builds the production settings card with canonical CSS and the existing
background launch harness. It checks disconnected, connected, and topics-disabled
states at two widths in light and dark themes. Screenshots are captured over CDP;
native windows must remain hidden and unfocused. Evidence is written under
`.bench-fixtures/telegram-settings-*`.

The probe also decodes synthetic Ogg/Opus audio through the production voice decoder
and checks rejection of corrupt input. Telegram replies are supplied by the fixture.
It does not exercise a live bot connection, account pairing, speech recognition, or
agent execution.
