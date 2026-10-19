# Moving the laptop's data to the Pi (USB drive)

The Pi gets an **exact mirror** of the laptop:
- the database `sining_kamay_db` (signs, recordings, users, conversations, quiz);
- `saved_gestures/` (sign.json, samples, avatar clips, the recorded audio);
- `models/` (`knn_ESL.bin`, `knn_FSL.bin`, the Vosk speech model).

The code comes from git (`git pull`); this moves the **data**. Videos are not copied: they are never in
`saved_gestures/` or `models/`.

## On the laptop (Windows)

1. Start **MySQL** in the XAMPP Control Panel.
2. Plug in a USB drive (FAT32, exFAT or NTFS; it needs about 100 MB free), say it is `F:`.
3. In a Command Prompt in the repo folder:

   ```bat
   tools\pi\export-from-laptop.cmd F:\
   ```

   This creates `F:\sk-transfer\`:

   | File | What |
   |---|---|
   | `sining_kamay_db.sql` | mysqldump of the DB, structure and data |
   | `saved_gestures\`, `models\` | mirrors of the repo folders |
   | `manifest.txt` | file counts, the SQL size, and the gestures / recordings / users row counts |

4. Eject the drive.

## On the Pi

1. Plug the drive in. It appears at `/media/<user>/<drive name>/sk-transfer`.
2. In a terminal (or over SSH):

   ```bash
   cd ~/SKv2
   bash tools/pi/import-on-pi.sh
   ```

   Give the folder if it is not found by itself:
   `bash tools/pi/import-on-pi.sh /media/$USER/MYDRIVE/sk-transfer`.

3. The script does four things:
   - backs up what the Pi had to `~/sk-backup-<date>/`;
   - imports the DB;
   - mirrors both folders (files the laptop no longer has are removed);
   - sets the permissions PHP needs.

   It then prints one `OK` / `DIFF` line per manifest count. All `OK` = the Pi mirrors the laptop.
4. Reload the kiosk, or reboot.

The first `pi-setup.sh` run can import the dump directly instead: `bash tools/pi/pi-setup.sh --dev --sql
/media/$USER/MYDRIVE/sk-transfer/sining_kamay_db.sql`. The two folders then still need `import-on-pi.sh`.

## Later updates

**Only the model changed** (you compiled on the laptop): `git pull` on the Pi is enough. The model files are tracked
in git, and the kiosk downloads a changed file once.

**New signs, audio or avatar clips:** run the export again on the laptop, then `import-on-pi.sh` on the Pi.

**Data recorded on the Pi** (signs saved there, conversations, quiz scores, users created there) **is replaced** by the
laptop's copy. The script backs it up to `~/sk-backup-<date>/` first, but it does not merge it.
