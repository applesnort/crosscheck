# Deception corpus

Twenty small modules written for round 3 of the consensus experiment. Some are
plainly exploitable, some are plainly safe, and ten are deliberate traps: code
that looks dangerous and is not, or looks safe and is not.

**Do not copy anything in `src/` into real software.** Several files are
exploitable on purpose, and several helpers behave differently from what their
names promise.

The source files carry no markers. Which file is which lives only in
`expected.json`, because a fixture that labels its own answers measures whether a
reviewer can read comments rather than whether it can read code.

Design, trap classes, predictions, and outcome: `../calibration/PREREGISTERED.md`.
