CREATE TABLE IF NOT EXISTS `streams` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `box_id` int unsigned NOT NULL,
  `max_segment` int unsigned NOT NULL,
  `start_time` datetime DEFAULT NULL,
  `end_time` datetime DEFAULT NULL,
  `last_upload_time` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS `segments` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `stream_id` int unsigned NOT NULL,
  `chunk_id` int DEFAULT NULL,
  `add_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `process_start_time` datetime DEFAULT NULL,
  `process_end_time` datetime DEFAULT NULL,
  `bees_in` int unsigned DEFAULT NULL,
  `bees_out` int unsigned DEFAULT NULL,
  `varroa_count` int DEFAULT NULL,
  `wespen_count` int DEFAULT NULL,
  `pollen_count` int DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;