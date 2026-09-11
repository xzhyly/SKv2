<?php
$host = "localhost";
$user = "root";
$pass = "";           // XAMPP default
$db   = "sining_kamay_db";

$conn = mysqli_connect($host, $user, $pass, $db);

if (!$conn) {
    // Headers already set by caller; just return error JSON and stop
    echo json_encode(["error" => "DB connection failed: " . mysqli_connect_error()]);
    exit;
}
?>