-- phpMyAdmin SQL Dump
-- A made-up sample in the shape of the MIOC app's export, for the suites.
-- No row here is a real student, and the catalogue rows are invented.

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";
/*!40101 SET NAMES utf8mb4 */;

DROP TABLE IF EXISTS `tb_students`;
CREATE TABLE `tb_students` (
  `id` int(11) NOT NULL,
  `name` text NOT NULL,
  `phone` text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

INSERT INTO `tb_students` (`id`, `name`, `phone`) VALUES
(1, 'Never Kept', '+910000000000'),
(2, 'Also (not) kept; INSERT INTO `tb_courses` VALUES', '0');

DROP TABLE IF EXISTS `tb_destinations`;
CREATE TABLE `tb_destinations` (
  `id` int(11) NOT NULL,
  `country` text NOT NULL,
  `capital` text DEFAULT NULL,
  `language` text DEFAULT NULL,
  `temperature` text DEFAULT NULL,
  `continent` text DEFAULT NULL,
  `description` text DEFAULT NULL,
  `status` text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

INSERT INTO `tb_destinations` (`id`, `country`, `capital`, `language`, `temperature`, `continent`, `description`, `status`) VALUES
(1, 'UK', 'Mioc Capital Town', 'English, Mioc Welsh', '1°C to 23°C', 'WESTERN EUROPE', 'An invented overview of studying in the UK, for the suites only.\r\n\r\nA second paragraph, also made up.', '1'),
(3, 'USA', 'Mioc Federal City', 'English', NULL, 'NORTH AMERICA', NULL, '1'),
(26, 'Vietnam', NULL, NULL, '10°C to 35°C', 'Southeast Asia', 'A made-up line about Vietnam.', '1'),
(32, 'Slovenia', 'Hidden Mioc City', 'Slovene', '-5°C to 30°C', 'CENTRAL EUROPE', 'Never shown: the destination is switched off.', '0');

DROP TABLE IF EXISTS `tb_country_faq`;
CREATE TABLE `tb_country_faq` (
  `id` int(11) NOT NULL,
  `d_id` text NOT NULL,
  `question` text NOT NULL,
  `answer` text NOT NULL,
  `order` int(11) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;

INSERT INTO `tb_country_faq` (`id`, `d_id`, `question`, `answer`, `order`) VALUES
(1, '1', 'How long is a Mioc master\'s?', 'One invented year.', 2),
(2, '1', 'What does a Mioc year cost?', 'An invented answer,\r\nover two lines.', 1),
(3, '1', 'A question nobody answered', '', 3),
(4, '32', 'Hidden question', 'Never shown.', 1);

DROP TABLE IF EXISTS `tb_country_accomodation`;
CREATE TABLE `tb_country_accomodation` (
  `id` int(11) NOT NULL,
  `d_id` text NOT NULL,
  `text` text NOT NULL,
  `status` text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

INSERT INTO `tb_country_accomodation` (`id`, `d_id`, `text`, `status`) VALUES
(1, '1', 'Invented halls and made-up shared flats.', '1'),
(2, '1', 'A switched-off note, never shown.', '0'),
(3, '26', 'Made-up homestays.', '1');

DROP TABLE IF EXISTS `tb_main_course`;
CREATE TABLE `tb_main_course` (`id` int(11) NOT NULL, `name` text NOT NULL) ENGINE=InnoDB;

INSERT INTO `tb_main_course` (`id`, `name`) VALUES
(5, 'Computer Science and IT'),
(9, 'Health Science');

DROP TABLE IF EXISTS `tb_universities`;
CREATE TABLE `tb_universities` (
  `id` int(11) NOT NULL,
  `d_id` text NOT NULL,
  `name` text NOT NULL,
  `location` text DEFAULT NULL,
  `rank` int(11) DEFAULT NULL,
  `status` text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

INSERT INTO `tb_universities` (`id`, `d_id`, `name`, `location`, `rank`, `status`) VALUES
(10, '1', 'Westbridge Mioc University', 'Leeds, England', 4, '1'),
(11, '1', 'Aston University', 'Birmingham', NULL, '1'),
(12, '3', 'Lakeshore Mioc College', 'Duluth, Minnesota, USA', NULL, '1'),
(13, '26', 'Saigon Mioc Institute', 'Ho Chi Minh City', NULL, '1'),
(14, '1', 'Closed Mioc College', 'Hull', NULL, '0'),
(15, '32', 'Ljubljana Mioc School', NULL, NULL, '1'),
(16, '1', 'Empty Mioc College', 'York', NULL, '1');

DROP TABLE IF EXISTS `tb_university_info`;
CREATE TABLE `tb_university_info` (
  `id` bigint(20) NOT NULL,
  `u_id` text NOT NULL,
  `type` text NOT NULL,
  `text` text NOT NULL,
  `order` int(11) NOT NULL,
  `status` text NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

INSERT INTO `tb_university_info` (`id`, `u_id`, `type`, `text`, `order`, `status`, `created_at`) VALUES
(1, '10', 'info', '34 in Webometrics Mioc National Ranking', 2, '1', '2024-01-01 00:00:00'),
(2, '10', 'about', 'Westbridge Mioc University is invented for the suites.\r\n\r\nIts second paragraph is made up too.', 0, '1', '2024-01-01 00:00:00'),
(3, '10', 'info', 'Type\tPublic research university', 0, '1', '2024-01-01 00:00:00'),
(4, '10', 'info', 'Web Url\r\n: www.westbridge-mioc.example/', 0, '1', '2024-01-01 00:00:00'),
(5, '10', 'info', 'QS World Ranking ; 1438', 1, '1', '2024-01-01 00:00:00'),
(6, '10', 'info', 'Address: 1 Switched Off Row', 0, '0', '2024-01-01 00:00:00'),
(7, '12', 'about', 'Lakeshore Mioc College is a made-up college by an imaginary lake.', 0, '1', '2024-01-01 00:00:00'),
(8, '12', 'info', 'Web Url : localhost', 0, '1', '2024-01-01 00:00:00'),
(9, '12', 'info', 'Established\t1901', 0, '1', '2024-01-01 00:00:00'),
(10, '14', 'about', 'Closed Mioc College is switched off and never comes over.', 0, '1', '2024-01-01 00:00:00'),
(11, '99', 'about', 'A profile for a university the app no longer has.', 0, '1', '2024-01-01 00:00:00');

DROP TABLE IF EXISTS `tb_courses`;
CREATE TABLE `tb_courses` (
  `id` int(11) NOT NULL,
  `u_id` text NOT NULL,
  `d_id` text NOT NULL,
  `c_id` text NOT NULL,
  `course` text NOT NULL,
  `level` text NOT NULL,
  `duration` text NOT NULL,
  `entryrequirement` text DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `intakes` text NOT NULL,
  `deadline` text DEFAULT NULL,
  `fees` text NOT NULL,
  `applicationfee` text NOT NULL,
  `currency` text DEFAULT NULL,
  `stipend` text DEFAULT NULL,
  `ielts` text DEFAULT NULL,
  `ieltsless` text DEFAULT NULL,
  `toefl` text DEFAULT NULL,
  `toeflless` text DEFAULT NULL,
  `pte` text DEFAULT NULL,
  `pteless` text DEFAULT NULL,
  `duolingo` text DEFAULT NULL,
  `act` text DEFAULT NULL,
  `sat` text DEFAULT NULL,
  `gmat` text DEFAULT NULL,
  `gre` text DEFAULT NULL,
  `det` text DEFAULT NULL,
  `order` int(11) NOT NULL,
  `status` text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

INSERT INTO `tb_courses` (`id`, `u_id`, `d_id`, `c_id`, `course`, `level`, `duration`, `entryrequirement`, `remarks`, `intakes`, `deadline`, `fees`, `applicationfee`, `currency`, `stipend`, `ielts`, `ieltsless`, `toefl`, `toeflless`, `pte`, `pteless`, `duolingo`, `act`, `sat`, `gmat`, `gre`, `det`, `order`, `status`) VALUES
(101, '10', '1', '5', 'MSc Data Science', 'Postgraduate', '12 months', '•60% in the bachelor\'s degree\r\n•No backlogs', 'It doesn\'t accept NIOS', 'January,September', 'ASAP', '17,500', 'NA', '£', NULL, '6.5', '6', '90', '20', '64', '59', '', '', '', '', '', '115', 1, '1'),
(102, '10', '1', '9', 'MSc Data Science', 'Postgraduate', '12 months', '•60% in the bachelor\'s degree\r\n•No backlogs', 'It doesn\'t accept NIOS', 'January,September', 'ASAP', '17,500', 'NA', '£', NULL, '6.5', '6', '90', '20', '64', '59', '', '', '', '', '', '115', 1, '1'),
(103, '10', '1', '5', 'International Foundation Year in Computing', 'Foundation', '7-10 months', NULL, '', 'SEP', 'ASAP', '14,250 for 3 semester pathway.', 'Waiver', '£', NULL, 'No Test Requirement', '', '', '', '', '', NULL, NULL, NULL, NULL, NULL, NULL, 1, '1'),
(104, '11', '1', '5', 'MSc Business Analytics', 'Postgraduate', '12 months', NULL, NULL, 'September', 'ASAP', '18,000', '0', '£', NULL, '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', 1, '1'),
(105, '12', '3', '9', 'B.S. in Nursing', 'Undergraduate', '48 Month(s) months', '•GPA: 3.0', NULL, 'January,August', 'Fall : 01 Jun, Spring : 15 Nov', '$32,760', '50', '$', NULL, '6', '5.5', '79', '17', '53', '', '', '21', '1060', '', '', '105', 1, '1'),
(106, '13', '26', '5', 'Bachelor of Business', 'Undergraduate', '2 YEARS months', NULL, NULL, 'Spring (jan),Fall (Aug)', 'NA', '5000', '30', 'USD', NULL, '6', NULL, '', NULL, '', NULL, '', '', '', '', '', '', 1, '1'),
(107, '14', '1', '5', 'MBA', 'Postgraduate', '12 months', NULL, NULL, 'September', 'ASAP', '20,000', 'NA', '£', NULL, '6.5', '6', '', '', '', '', '', '', '', '', '', '', 1, '1'),
(108, '99', '1', '5', 'MSc Orphaned', 'Postgraduate', '12 months', NULL, NULL, 'September', 'ASAP', '20,000', 'NA', '£', NULL, '6.5', '6', '', '', '', '', '', '', '', '', '', '', 1, '1'),
(109, '15', '32', '5', 'MSc Hidden Country', 'Postgraduate', '12 months', NULL, NULL, 'September', 'ASAP', '9,000', 'NA', '€', NULL, '6.5', '6', '', '', '', '', '', '', '', '', '', '', 1, '1'),
(110, '12', '3', '5', 'M.S. in Computer Science', 'Postgraduate', '24 months', NULL, NULL, 'August', 'ASAP', '24,104/Year', 'If applying through the portal: USD 75 plus USD 10', '$', NULL, '6.5', '6', '80', '', '58', '', '', '', '', '550', '300', '', 1, '1'),
(111, '12', '3', '5', 'M.S. in Computer Science', 'Postgraduate', '24 months', NULL, NULL, 'January', 'ASAP', '24,104/Year', '75', '$', NULL, '6.5', '6', '80', '', '58', '', '', '', '', '550', '300', '', 1, '1'),
(112, '11', '1', '5', 'MSc Business Analytics', 'Pathway programs', '12 months', NULL, NULL, 'January', 'ASAP', '19,000', 'NA', '£', NULL, '6', '5.5', '', '', '', '', '', '', '', '', '', '', 1, '1');

COMMIT;
