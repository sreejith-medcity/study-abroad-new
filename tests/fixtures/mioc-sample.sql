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
  `status` text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

INSERT INTO `tb_destinations` (`id`, `country`, `status`) VALUES
(1, 'UK', '1'),
(3, 'USA', '1'),
(26, 'Vietnam', '1'),
(32, 'Slovenia', '0');

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
