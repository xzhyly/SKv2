# Raspberry Pi Deployment and Autostart Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Sining Kamay project from the Windows laptop to the Raspberry Pi, import the database schema, enable the servers (Apache & MariaDB) on system boot, and configure Google Chrome to launch in fullscreen kiosk mode on startup.

**Architecture:** We will copy the code via SSH/tar archive, configure local Apache and MariaDB services on the Pi, allow passwordless root database login to maintain PHP compatibility, and edit the Raspberry Pi OS desktop environment autostart scripts (X11 LXDE or Wayland Labwc) to trigger Chromium kiosk mode pointing to localhost.

**Tech Stack:** Linux (Raspberry Pi OS), Apache2, MariaDB (MySQL), PHP, Chromium Browser.

## Global Constraints

- Must work under the Raspberry Pi username `crystelle`.
- Hostname of Pi is `raspberrypicrystelle`.
- Must preserve PHP MySQL configuration in `php/connect.php` (host `localhost`, user `root`, no password).

---

### Task 1: Archive and Transfer Files to the Raspberry Pi

**Files:**
- Create: `c:\xampp\htdocs\Sining_kamay.tar.gz` (temporary tarball on Laptop)
- Transfer: `/home/crystelle/Sining_kamay.tar.gz` on Raspberry Pi

**Interfaces:**
- Consumes: Existing files in `c:\xampp\htdocs\Sining_kamay`
- Produces: Transferred tarball in `/home/crystelle/` on Raspberry Pi

- [ ] **Step 1: Open CMD on Windows laptop and navigate to the project directory**

Open a Command Prompt (CMD) on your Windows Laptop.

- [ ] **Step 2: Create a compressed tarball archive of the Sining_kamay folder**

Run the following command on the Laptop CMD to bundle the project files:
```cmd
tar -czf Sining_kamay.tar.gz -C c:\xampp\htdocs Sining_kamay
```
Expected: A file named `Sining_kamay.tar.gz` will be created in your laptop's current directory.

- [ ] **Step 3: Transfer the archive to the Raspberry Pi using SCP**

Run the SCP command in Laptop CMD:
```cmd
scp Sining_kamay.tar.gz crystelle@192.168.68.114:/home/crystelle/
```
Expected: Progress bar finishes and file transfers successfully. (You will be prompted for username `crystelle`'s password).

---

### Task 2: Install Apache, PHP, and MariaDB on the Raspberry Pi

**Files:**
- Modify: System services on Raspberry Pi

**Interfaces:**
- Consumes: Raspberry Pi APT repositories.
- Produces: Running `apache2` and `mariadb` services configured to auto-start on boot.

- [ ] **Step 1: SSH into the Raspberry Pi from Laptop CMD**

Run:
```cmd
ssh crystelle@192.168.68.114
```

- [ ] **Step 2: Update the package list on the Pi**

Run:
```bash
sudo apt update
```

- [ ] **Step 3: Install Apache, PHP, MariaDB, and PHP MySQL libraries**

Run:
```bash
sudo apt install apache2 php libapache2-mod-php mariadb-server php-mysql -y
```
Expected: Package downloads and installations finish without errors.

- [ ] **Step 4: Enable Apache and MariaDB services to start automatically on system boot**

Run:
```bash
sudo systemctl enable apache2 --now
sudo systemctl enable mariadb --now
```
Expected: Terminal shows symlinks created. Verify status of both:
```bash
sudo systemctl status apache2
sudo systemctl status mariadb
```
They should report `active (running)`.

---

### Task 3: Extract and Set Permissions on Web Root

**Files:**
- Modify: `/var/www/html/Sining_kamay` (extracted folder)

**Interfaces:**
- Consumes: `/home/crystelle/Sining_kamay.tar.gz`
- Produces: Project files in `/var/www/html/Sining_kamay/` with correct ownership.

- [ ] **Step 1: Extract the project archive on the Pi**

Run:
```bash
tar -xzf /home/crystelle/Sining_kamay.tar.gz -C /home/crystelle/
```
Expected: A folder named `Sining_kamay` is created under `/home/crystelle/`.

- [ ] **Step 2: Move the folder to the Apache web root**

Run:
```bash
sudo mv /home/crystelle/Sining_kamay /var/www/html/
```

- [ ] **Step 3: Adjust directory ownership and permissions**

Change owner to `www-data` (the Apache user) and set directory permissions:
```bash
sudo chown -R www-data:www-data /var/www/html/Sining_kamay
sudo chmod -R 755 /var/www/html/Sining_kamay
```

---

### Task 4: Configure Database and Import Schema

**Files:**
- Modify: MariaDB database engine schemas

**Interfaces:**
- Consumes: `/var/www/html/Sining_kamay/db-schema/database_setup.sql`
- Produces: Loaded database tables under `sining_kamay_db`.

- [ ] **Step 1: Open MariaDB prompt as root**

Run:
```bash
sudo mysql -u root
```

- [ ] **Step 2: Run configuration queries**

Type the following queries into the MariaDB CLI:
```sql
CREATE DATABASE sining_kamay_db;
ALTER USER 'root'@'localhost' IDENTIFIED VIA mysql_native_password USING PASSWORD('');
GRANT ALL PRIVILEGES ON sining_kamay_db.* TO 'root'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```
Expected: Queries output `Query OK, ...` and you exit to the normal shell.

- [ ] **Step 3: Import the SQL schema**

Run:
```bash
sudo mysql -u root sining_kamay_db < /var/www/html/Sining_kamay/db-schema/database_setup.sql
```
Expected: Command finishes silently without errors.

- [ ] **Step 4: Verify the database tables exist**

Run:
```bash
sudo mysql -u root sining_kamay_db -e "SHOW TABLES;"
```
Expected: Table list (e.g. `esl_signs`, `fsl_signs`, `translations`) prints to screen.

---

### Task 5: Configure Automatic Fullscreen Kiosk on Boot

**Files:**
- Create/Modify: Autostart configurations for Raspberry Pi desktop session

**Interfaces:**
- Consumes: Chromium browser packages on local Pi system
- Produces: Launch script executed on desktop environment initialization.

- [ ] **Step 1: Check the active desktop session type**

Run:
```bash
echo $XDG_SESSION_TYPE
```
Note the output (`x11` or `wayland`).

- [ ] **Step 2: Configure Autostart for X11 session**

If the session type in Step 1 is `x11` (or if you are on Raspberry Pi OS Bullseye):
Run:
```bash
mkdir -p ~/.config/lxsession/LXDE-pi
nano ~/.config/lxsession/LXDE-pi/autostart
```
Add these lines to the bottom of the file (or overwrite it):
```text
@xset s off
@xset -dpms
@xset s noblank
@chromium-browser --noerrdialogs --disable-infobars --kiosk http://localhost/Sining_kamay/
```
Save and exit.

- [ ] **Step 3: Configure Autostart for Wayland session**

If the session type in Step 1 is `wayland` (default on Raspberry Pi OS Bookworm):
Run:
```bash
mkdir -p ~/.config/labwc
nano ~/.config/labwc/autostart
```
Add the following line to the end of the file:
```text
chromium-browser --noerrdialogs --disable-infobars --kiosk http://localhost/Sining_kamay/ &
```
Save and exit.

- [ ] **Step 4: Reboot the Raspberry Pi to test the kiosk setup**

Run:
```bash
sudo reboot
```
Expected: The Raspberry Pi boots up, starts MariaDB and Apache automatically, loads the graphical desktop, and launches Google Chrome in fullscreen kiosk mode loading `http://localhost/Sining_kamay/` automatically.
