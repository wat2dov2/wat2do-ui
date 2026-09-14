BEGIN;

-- Each school owns its enumerated faculty choices; clients never substitute
-- another school's options when its list has not yet been populated.
-- https://uwaterloo.ca/faculties-academics-health
UPDATE public.schools SET faculties = ARRAY[
    'Arts', 'Engineering', 'Environment', 'Health', 'Mathematics', 'Science'
] WHERE slug = 'uwaterloo';

-- https://discover.mcmaster.ca/study/
UPDATE public.schools SET faculties = ARRAY[
    'DeGroote School of Business', 'Engineering', 'Health Sciences',
    'Humanities', 'Science', 'Social Sciences'
] WHERE slug = 'mcmaster';

-- https://uqam.ca/facultes/
UPDATE public.schools SET faculties = ARRAY[
    'Arts', 'Communication', 'Science politique et droit', 'Sciences',
    'Sciences de l’éducation', 'Sciences de la gestion',
    'Sciences de la santé', 'Sciences humaines'
] WHERE slug = 'uqam';

-- https://www.mcgill.ca/faculties/
UPDATE public.schools SET faculties = ARRAY[
    'Agricultural and Environmental Sciences', 'Arts',
    'Dental Medicine and Oral Health Sciences', 'Education', 'Engineering',
    'Law', 'Desautels Faculty of Management', 'Medicine and Health Sciences',
    'Schulich School of Music', 'Science', 'Continuing Studies',
    'Graduate and Postdoctoral Studies'
] WHERE slug = 'mcgill';

-- https://www.ulaval.ca/facultes
UPDATE public.schools SET faculties = ARRAY[
    'Aménagement, architecture, art et design', 'Droit',
    'Études supérieures et postdoctorales', 'Foresterie, géographie et géomatique',
    'Lettres et sciences humaines', 'Médecine', 'Médecine dentaire', 'Musique',
    'Pharmacie', 'Philosophie', 'Sciences de l’administration',
    'Sciences de l’agriculture et de l’alimentation', 'Sciences de l’éducation',
    'Sciences et génie', 'Sciences infirmières', 'Sciences sociales',
    'Théologie et sciences religieuses', 'École supérieure d’études internationales'
] WHERE slug = 'laval';

-- https://www.umontreal.ca/facultes-et-ecoles/
UPDATE public.schools SET faculties = ARRAY[
    'Aménagement', 'Arts et sciences', 'Droit', 'Médecine', 'Médecine dentaire',
    'Médecine vétérinaire', 'Musique', 'Optométrie', 'Pharmacie',
    'Santé publique', 'Sciences de l’éducation', 'Sciences infirmières',
    'Apprentissage continu'
] WHERE slug = 'udem';

-- https://brocku.ca/academics/
UPDATE public.schools SET faculties = ARRAY[
    'Applied Health Sciences', 'Education', 'Goodman School of Business',
    'Graduate Studies and Postdoctoral Affairs', 'Humanities',
    'Mathematics and Science', 'Social Sciences'
] WHERE slug = 'brocku';

-- https://wlu.ca/academics/faculties/index.html
UPDATE public.schools SET faculties = ARRAY[
    'Arts', 'Education', 'Graduate and Postdoctoral Studies',
    'Human and Social Sciences', 'Liberal Arts', 'Music', 'Science',
    'Lyle S. Hallman Faculty of Social Work',
    'Lazaridis School of Business and Economics',
    'International Policy and Governance'
] WHERE slug = 'wlu';

-- https://carleton.ca/about/contact/
UPDATE public.schools SET faculties = ARRAY[
    'Arts and Social Sciences', 'Engineering and Design',
    'Public and Global Affairs', 'Science', 'Sprott School of Business'
] WHERE slug = 'carleton';

-- https://www.queensu.ca/academics/programs
UPDATE public.schools SET faculties = ARRAY[
    'Arts and Science', 'Education', 'Graduate Studies and Postdoctoral Affairs',
    'Health Sciences', 'Law', 'Smith School of Business',
    'Smith Engineering and Applied Science'
] WHERE slug = 'queens';

-- https://international.uwo.ca/learning/pdf/Fact%20Sheet.pdf
UPDATE public.schools SET faculties = ARRAY[
    'Arts and Humanities', 'Education', 'Engineering', 'Health Sciences',
    'Information and Media Studies', 'Law', 'Science', 'Social Science',
    'Don Wright Faculty of Music', 'Ivey Business School',
    'Schulich School of Medicine and Dentistry', 'Graduate and Postdoctoral Studies'
] WHERE slug = 'western';

-- https://www.uottawa.ca/about-us/faculties
UPDATE public.schools SET faculties = ARRAY[
    'Arts', 'Education', 'Engineering', 'Health Sciences', 'Droit civil',
    'Law - Common Law', 'Medicine', 'Science', 'Social Sciences',
    'Telfer School of Management'
] WHERE slug = 'uottawa';

-- https://www.torontomu.ca/programs/faculties/
UPDATE public.schools SET faculties = ARRAY[
    'Arts', 'Community Services', 'Engineering and Architectural Science',
    'Science', 'Lincoln Alexander School of Law', 'School of Medicine',
    'Ted Rogers School of Management', 'The Creative School',
    'Yeates School of Graduate and Postdoctoral Studies'
] WHERE slug = 'tmu';

-- https://www.sfu.ca/students/admission/terminology.html
UPDATE public.schools SET faculties = ARRAY[
    'Applied Sciences', 'Arts and Social Sciences', 'Beedie School of Business',
    'Communication, Art and Technology', 'Education', 'Environment',
    'Health Sciences', 'Science'
] WHERE slug = 'sfu';

-- https://www.concordia.ca/academics/units.html
UPDATE public.schools SET faculties = ARRAY[
    'Arts and Science', 'Gina Cody School of Engineering and Computer Science',
    'Fine Arts', 'John Molson School of Business', 'Graduate Studies', 'Health'
] WHERE slug = 'concordia';

-- https://umanitoba.ca/academics
UPDATE public.schools SET faculties = ARRAY[
    'Agricultural and Food Sciences', 'Architecture', 'Art', 'Arts',
    'I. H. Asper School of Business', 'Education', 'Price Faculty of Engineering',
    'Clayton H. Riddell Faculty of Environment, Earth, and Resources',
    'Extended Education', 'Graduate and Postdoctoral Studies',
    'Rady Faculty of Health Sciences', 'Kinesiology and Recreation Management',
    'Law', 'Desautels Faculty of Music', 'Science', 'Social Work', 'University 1'
] WHERE slug = 'umanitoba';

-- https://researchdirectory.ucalgary.ca/faculties
UPDATE public.schools SET faculties = ARRAY[
    'Cumming School of Medicine', 'Arts', 'Kinesiology', 'Law', 'Nursing',
    'Science', 'Social Work', 'Veterinary Medicine', 'Haskayne School of Business',
    'Architecture, Planning, and Landscape', 'Public Policy',
    'Schulich School of Engineering', 'Werklund School of Education'
] WHERE slug = 'ucalgary';

-- https://programs.usask.ca/programs/colleges-and-schools.php
UPDATE public.schools SET faculties = ARRAY[
    'Agriculture and Bioresources', 'Arts and Science', 'Dentistry', 'Education',
    'Edwards School of Business', 'Engineering', 'Graduate and Postdoctoral Studies',
    'Johnson Shoyama Graduate School of Public Policy', 'Kinesiology', 'Law',
    'Medicine', 'Nursing', 'Pharmacy and Nutrition', 'Environment and Sustainability',
    'Public Health', 'Rehabilitation Science', 'St. Thomas More College',
    'Western College of Veterinary Medicine'
] WHERE slug = 'usask';

-- https://www.uvic.ca/academics/faculties-schools-and-services/index.php
UPDATE public.schools SET faculties = ARRAY[
    'Business', 'Education', 'Engineering and Computer Science', 'Fine Arts',
    'Graduate Studies', 'Health', 'Humanities', 'Law', 'Science', 'Social Sciences'
] WHERE slug = 'uvic';

-- https://www.uwindsor.ca/faculties-and-departments
UPDATE public.schools SET faculties = ARRAY[
    'Arts, Humanities and Social Sciences', 'Education', 'Engineering',
    'Graduate Studies', 'Human Kinetics', 'Law', 'Nursing',
    'Odette School of Business', 'Science'
] WHERE slug = 'windsor';

-- https://ontariotechu.ca/academics/faculties/index.php
UPDATE public.schools SET faculties = ARRAY[
    'Business and Information Technology', 'Engineering and Applied Science',
    'Health Sciences', 'Science', 'Social Science and Humanities',
    'Frazer Faculty of Education', 'Artificial Intelligence',
    'Graduate and Postdoctoral Studies'
] WHERE slug = 'ontariotech';

-- https://www.ocadu.ca/academics
UPDATE public.schools SET faculties = ARRAY[
    'Art', 'Design', 'Arts and Science', 'Graduate Studies', 'Continuing Studies'
] WHERE slug = 'ocad';

-- https://www.uoguelph.ca/academics/departments
UPDATE public.schools SET faculties = ARRAY[
    'Arts', 'Biological Science', 'Gordon S. Lang School of Business and Economics',
    'Computational, Mathematical, and Physical Sciences', 'Engineering',
    'Social and Applied Human Sciences', 'Ontario Agricultural College',
    'Ontario Veterinary College'
] WHERE slug = 'guelph';

-- https://www.utoronto.ca/academics/academic-units
UPDATE public.schools SET faculties = ARRAY[
    'Applied Science and Engineering', 'Architecture, Landscape and Design',
    'Arts and Science', 'Continuing Studies', 'Dentistry', 'Education',
    'Graduate Studies', 'Information', 'Kinesiology and Physical Education',
    'Law', 'Management', 'Medicine', 'Music', 'Nursing', 'Pharmacy',
    'Public Health', 'Social Work'
] WHERE slug = 'utoronto';

-- UTM and UTSC are themselves academic divisions, not Waterloo-style faculties.
-- https://www.utoronto.ca/academics/academic-units
UPDATE public.schools SET faculties = ARRAY['University of Toronto Mississauga']
WHERE slug = 'utm';
UPDATE public.schools SET faculties = ARRAY['University of Toronto Scarborough']
WHERE slug = 'utsc';

-- https://www.upenn.edu/academics/schools
UPDATE public.schools SET faculties = ARRAY[
    'Arts and Sciences', 'The Wharton School', 'Annenberg School for Communication',
    'Dental Medicine', 'Stuart Weitzman School of Design', 'Graduate School of Education',
    'Engineering and Applied Science', 'Penn Carey Law', 'Perelman School of Medicine',
    'Nursing', 'Social Policy and Practice', 'Veterinary Medicine'
] WHERE slug = 'upenn';

-- https://www.cornell.edu/academics/colleges.cfm
UPDATE public.schools SET faculties = ARRAY[
    'Agriculture and Life Sciences', 'Architecture, Art and Planning',
    'Arts and Sciences', 'Cornell SC Johnson College of Business',
    'Cornell Ann S. Bowers College of Computing and Information Science',
    'Cornell David A. Duffield College of Engineering', 'Human Ecology',
    'Industrial and Labor Relations', 'Cornell Jeb E. Brooks School of Public Policy',
    'Cornell Tech', 'Cornell Law School', 'Veterinary Medicine', 'Graduate School',
    'Weill Cornell Medicine', 'Weill Cornell Medicine-Qatar',
    'Weill Cornell Graduate School of Medical Sciences',
    'Continuing Education and Summer Sessions'
] WHERE slug = 'cornell';

-- https://www.yorku.ca/about/our-faculties/
UPDATE public.schools SET faculties = ARRAY[
    'Arts, Media, Performance and Design', 'Education',
    'Environmental and Urban Change', 'Glendon', 'Graduate Studies', 'Health',
    'Lassonde School of Engineering', 'Liberal Arts and Professional Studies',
    'Osgoode Hall Law School', 'Schulich School of Business', 'Science'
] WHERE slug = 'york';

-- https://www.mun.ca/people_departments/faculties-and-schools/
UPDATE public.schools SET faculties = ARRAY[
    'Business Administration', 'Education', 'Engineering and Applied Science',
    'Humanities and Social Sciences', 'Medicine', 'Nursing', 'Science',
    'Marine Institute', 'Arctic and Subarctic Studies', 'Graduate Studies',
    'Human Kinetics and Recreation', 'Music', 'Pharmacy', 'Social Work',
    'Grenfell Campus'
] WHERE slug = 'memorial';

-- https://www.dal.ca/study/faculties.html
UPDATE public.schools SET faculties = ARRAY[
    'Agriculture', 'Architecture and Planning', 'Arts and Social Sciences',
    'Computer Science', 'Dentistry', 'Engineering', 'Graduate Studies', 'Health',
    'Schulich School of Law', 'Management', 'Medicine', 'Science',
    'Open Learning and Career Development'
] WHERE slug = 'dalhousie';

-- https://www.mit.edu/education/
UPDATE public.schools SET faculties = ARRAY[
    'Architecture and Planning', 'Engineering', 'Humanities, Arts, and Social Sciences',
    'MIT Sloan School of Management', 'Science', 'MIT Schwarzman College of Computing'
] WHERE slug = 'mit';

-- https://www.ubc.ca/our-campuses/vancouver/directories/faculties-schools.html
UPDATE public.schools SET faculties = ARRAY[
    'Applied Science', 'Arts', 'Sauder School of Business', 'Dentistry',
    'Education', 'Forestry and Environmental Stewardship',
    'Graduate and Postdoctoral Studies', 'Land and Food Systems',
    'Peter A. Allard School of Law', 'Medicine', 'Pharmaceutical Sciences',
    'Science', 'Extended Learning', 'UBC Vantage College'
] WHERE slug = 'ubc';

-- https://apps.ualberta.ca/catalogue/search
UPDATE public.schools SET faculties = ARRAY[
    'Augustana', 'Faculté Saint-Jean', 'Agricultural, Life and Environmental Sciences',
    'Arts', 'Business', 'Education', 'Engineering', 'Graduate and Postdoctoral Studies',
    'Kinesiology, Sport, and Recreation', 'Law', 'Medicine and Dentistry',
    'Native Studies', 'Nursing', 'Pharmacy and Pharmaceutical Sciences',
    'Rehabilitation Medicine', 'Science', 'Online and Continuing Education', 'Public Health'
] WHERE slug = 'ualberta';

-- https://www.columbia.edu/content/academics/schools
UPDATE public.schools SET faculties = ARRAY[
    'Architecture, Planning, and Preservation', 'Arts', 'Dental Medicine',
    'Columbia Journalism School', 'Columbia Law School', 'Nursing',
    'Professional Studies', 'Mailman School of Public Health', 'Social Work',
    'Vagelos College of Physicians and Surgeons', 'Columbia Business School',
    'Columbia College', 'Fu Foundation School of Engineering and Applied Science',
    'General Studies', 'Graduate School of Arts and Sciences',
    'International and Public Affairs', 'Columbia Climate School'
] WHERE slug = 'columbia';

-- https://www.berkeley.edu/academics/schools-colleges/
UPDATE public.schools SET faculties = ARRAY[
    'Haas School of Business', 'Chemistry', 'Computing, Data Science and Society',
    'Education', 'Engineering', 'Environmental Design', 'Information', 'Journalism',
    'Law', 'Letters and Science', 'Rausser College of Natural Resources',
    'Optometry', 'Public Health', 'Goldman School of Public Policy', 'Social Welfare'
] WHERE slug = 'berkeley';

-- https://bulletins.nyu.edu/nyu/about/locations-facilities/
UPDATE public.schools SET faculties = ARRAY[
    'Arts and Science', 'Grossman Long Island School of Medicine',
    'Grossman School of Medicine', 'Dentistry', 'Gallatin School of Individualized Study',
    'Graduate School of Arts and Science', 'Leonard N. Stern School of Business',
    'NYU Abu Dhabi', 'NYU Shanghai', 'Robert F. Wagner Graduate School of Public Service',
    'Rory Meyers College of Nursing', 'Global Public Health', 'Law', 'Professional Studies',
    'Silver School of Social Work', 'Steinhardt School of Culture, Education, and Human Development',
    'Tandon School of Engineering', 'Tisch School of the Arts'
] WHERE slug = 'nyu';

COMMIT;
