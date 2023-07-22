CREATE TABLE IF NOT EXISTS `video_streams` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `box_id` int unsigned NOT NULL,
  `max_segment` int unsigned NOT NULL,
  `date_start` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;