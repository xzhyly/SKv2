# docs/revision — rules

Every REVISE and REPORT file in this pipeline points back to this file.
Read MEMORY.md too before acting on either.

1. Read MEMORY.md first, every time — its conventions and "do not touch"
   list are binding.
2. Scope is exactly what the file you're reading names. No "while I'm here"
   fixes, no unrelated refactors.
3. Never estimate or invent a number. Cite file:line or measure it. If it's
   not in the code, write "not specified" — never guess.
4. Claude Code's job stops at writing the REVISE file. It never edits code
   in this pipeline.
5. Antigravity executes exactly what's in the REVISE file. Light item:
   locate it, apply the described fix. Precise item: use the exact
   FIND/REPLACE given, no undeclared deviation.
6. If a REVISE item doesn't match current code (already fixed, moved, gone)
   — stop that item, mark it "skipped" in the REPORT with why. Don't
   substitute your own judgment for what it should be.
7. One commit per completed item. Message = FILE + one-line WHY.
8. Run the item's own VERIFY check before reporting it done — not "looks
   right."
9. Never touch a file that isn't named. `git diff --stat` at the end must
   match the named file list exactly.
10. Never touch reports.html or gesture-training.html unless a cycle names
    them explicitly (hover-removal there is still deferred).
