<?php

$path = "./input2/";

$files = scandir($path);

function cropOneOf9($x, $y, $source, $width, $height, $name, $ext)
{
    $srcX = ($width / 3) * $x;
    $srcY = ($height / 3) * $y;

    $target = @imagecreatetruecolor($width / 3, $height / 3);

    imagecopyresized(
        $target,
        $source,
        0, 0,
        $srcX,
        $srcY,
        $width / 3, $height / 3,
        $width / 3, $height / 3
    );
    imagejpeg($target, "./out2/{$name}_{$x}_{$y}.{$ext}");
    imagedestroy($target);

}

foreach ($files as $filename) {
    if ($filename == '.' || $filename == '..') {
        continue;
    }

    list($name, $ext) = explode('.', $filename);

    if ($ext !== 'JPG') {
        continue;
    }

    $source = @imagecreatefromjpeg("{$path}$name.$ext");
    $width = imagesx($source);
    $height = imagesy($source);


    for ($x = 0; $x < 3; $x++) {
        for ($y = 0; $y < 3; $y++) {
            cropOneOf9($x, $y, $source, $width, $height, $name, $ext);
        }
    }
}
