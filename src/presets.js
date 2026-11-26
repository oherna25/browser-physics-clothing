// Every option the UI offers lives here as plain data. Metres, y up, toes point +z.

// leg: centreline joints [y, z, radius]; past the ankle the line runs down the foot into the second toe and ends on the
// line through the big and little toes' tips, where the rings over the toes turn to lie.
// foot: owned by its leg. heel: capsule ends [y, z, radius] from the ankle down to the back of the heel, which it
// rounds where the rows' ends would leave a notch under the Achilles. rows: one capsule across the foot per
// interpolated row, [z, inner edge, outer edge, inner top, outer top, inner sole, outer sole], edges measured from
// the leg's line, so each end's radius is half its height. The inner sole stands higher over the midfoot (the arch),
// and the last row's tops sit level with the toes' so the stocking does not step down onto them. toes: big toe
// first, each a chain of capsule ends [out, y, z, r], `out` measured from the leg's line toward the outer side. The
// masculine tables are the feminine ones scaled about the ankle: lengths by 1.043, heights by 1.05, widths by 1.07.
// knit: the stocking's ring pitch along the leg down to the foot, which takes its own rings about as far apart, so
// reshaping the foot leaves the leg's rings where they are.
// pelvis, glutes, waist: capsule pairs [[x, y, z, r], [x, y, z, r]], addressed by name so
// the thigh and glute modifiers never depend on array order. trunk: crotch, ring centre z and the
// height where skin rings stop running horizontally and fan upward over the shoulders.
// torso: rows [y, halfWidth, z, r], one horizontal capsule from -halfWidth to +halfWidth per interpolated
// row, so the section at a height is a stadium. neck: centre-line joints [y, z, r]; its top row is where
// the skin is cut flat. None of the three responds to the build sliders.
// chest: optional, both breasts at the largest size. Each row is a chain of capsules across the chest at height
// `anchor` - d, with nodes at x = apex + u * reach for u in `nodes` (reach wi toward the midline, wo toward the side),
// mirrored for -x, plus one on the midline. A node's capsule stands its radius r under H(x), the sum of both breasts'
// heights (1 - t^2)^3 * f off the ribcage, f a share of the full projection. Rows are [d, f, r, wi, wo]. apex is the
// crest's x at size 0 and size 1. A slider size scales f, and d, r, wi and wo with it, and the rows are interpolated
// BUILD.chest.step apart. The underside's profile bends concave no tighter than r, since a union of capsules that wide
// turns a tighter fold into a crease.
// The garments' rest shape is cut from the body plus `shell`, rows that replace the ones from the apex down and run
// the underside out to the ribcage, and a capsule from apex to apex in every row at `bridge` of f, so fabric bridges
// the cleft and the crease under the bust instead of following them in.
// arm: right arm centre-line joints [x, y, z, r] from the shoulder pivot to the wrist, hanging in an A-pose; the
// left arm mirrors x. hand: a mitten past the wrist, rows [d, halfWidth, r] at distance d along the forearm's line,
// one capsule per interpolated row running front to back, so the palm faces the thigh.
// head: capsule pairs owned by the root. The first is a mid-skull row (its middle is where the head skin's rays
// start), the second the top of the neck, the rest front-to-back rows stacked from chin to crown: an egg that is
// deeper than it is wide and tapers to the jaw. No features.
// joints: sagittal hinge pivots [y, z], each on a leg or arm centre-line joint, so the capsule end there turns in
// place. Hip and shoulder pivots are the centres of the spheres that start their chains, so a thigh or an arm turns
// as a ball in its socket. Both bodies share leg joint heights, so stocking top, skirt waist and floor contact stay valid.
// Pose angles are radians about x: positive hip flexes the thigh forward, positive knee folds the shank back,
// positive ankle lifts the toes, positive shoulder swings the arm forward, positive elbow flexes the forearm
// forward, positive root pitch leans the body forward about the hip pivot.
export const BODIES = {
  feminine: {
    label: 'Feminine',
    leg: [
      [0.900, 0.000, 0.088],
      [0.780, 0.004, 0.086],
      [0.640, 0.008, 0.074],
      [0.520, 0.010, 0.060],
      [0.470, 0.012, 0.054], // knee
      [0.420, 0.006, 0.050],
      [0.340, -0.006, 0.055], // calf
      [0.240, -0.006, 0.046],
      [0.150, -0.002, 0.036],
      [0.095, 0.006, 0.034], // ankle
      [0.056, 0.042, 0.027],
      [0.022, 0.105, 0.011],
      [0.0135, 0.1768, 0.002], // in the second toe, on the line through the big and little toes' tips
    ],
    foot: {
      heel: [[0.095, 0.006, 0.032], [0.044, -0.028, 0.030]],
      rows: [
        [-0.024, 0.029, 0.029, 0.062, 0.062, 0.006, 0.006],
        [-0.018, 0.033, 0.033, 0.066, 0.066, 0.006, 0.006],
        [-0.006, 0.032, 0.034, 0.072, 0.066, 0.007, 0.006],
        [0.012, 0.030, 0.035, 0.076, 0.062, 0.010, 0.006],
        [0.030, 0.030, 0.038, 0.075, 0.052, 0.013, 0.007],
        [0.054, 0.032, 0.042, 0.072, 0.047, 0.016, 0.008],
        [0.072, 0.036, 0.046, 0.066, 0.042, 0.016, 0.008],
        [0.090, 0.041, 0.050, 0.057, 0.037, 0.012, 0.007],
        [0.102, 0.045, 0.052, 0.051, 0.034, 0.009, 0.006],
        [0.114, 0.046, 0.050, 0.046, 0.030, 0.006, 0.006],
        [0.126, 0.044, 0.045, 0.041, 0.026, 0.006, 0.007],
        [0.138, 0.041, 0.040, 0.036, 0.023, 0.007, 0.008],
        [0.150, 0.037, 0.022, 0.032, 0.021, 0.008, 0.009],
      ],
      toes: [
        [[-0.0250, 0.0210, 0.1240, 0.0135], [-0.0210, 0.0185, 0.1660, 0.0120], [-0.0185, 0.0165, 0.1890, 0.0105]],
        [[-0.0020, 0.0190, 0.1220, 0.0090], [-0.0010, 0.0160, 0.1570, 0.0078], [0.0000, 0.0128, 0.1845, 0.0062]],
        [[0.0140, 0.0180, 0.1170, 0.0088], [0.0130, 0.0150, 0.1520, 0.0074], [0.0115, 0.0125, 0.1775, 0.0060]],
        [[0.0285, 0.0170, 0.1110, 0.0084], [0.0255, 0.0145, 0.1440, 0.0070], [0.0230, 0.0120, 0.1660, 0.0057]],
        [[0.0420, 0.0160, 0.1040, 0.0080], [0.0375, 0.0135, 0.1330, 0.0066], [0.0345, 0.0115, 0.1540, 0.0054]],
      ],
    },
    hipX: 0.092,
    knit: 0.0077215376,
    pelvis: [[[-0.075, 0.92, -0.005, 0.105], [0.075, 0.92, -0.005, 0.105]]],
    glutes: [[[-0.06, 0.905, -0.035, 0.095], [0.06, 0.905, -0.035, 0.095]]],
    waist: [
      [[-0.045, 0.95, 0, 0.1], [-0.04, 1.2, 0, 0.085]],
      [[0.045, 0.95, 0, 0.1], [0.04, 1.2, 0, 0.085]],
    ],
    torso: [
      [0.96, 0.045, 0, 0.0995], // from here to 1.10 the rows fill the crease between the two waist capsules
      [1.03, 0.0434, 0, 0.0952],
      [1.10, 0.042, 0, 0.091],
      [1.16, 0.044, 0, 0.087],
      [1.20, 0.040, 0, 0.085],
      [1.25, 0.048, 0, 0.086],
      [1.29, 0.060, 0.003, 0.086],
      [1.33, 0.086, 0.002, 0.074],
      [1.36, 0.102, 0, 0.062], // shoulder stump
      [1.385, 0.080, 0, 0.058],
      [1.395, 0.050, 0, 0.057],
    ],
    neck: [[1.395, 0.004, 0.057], [1.46, 0.008, 0.052], [1.53, 0.012, 0.050]],
    chest: {
      anchor: 1.37,
      apex: [0.070, 0.066],
      nodes: [-1, -0.85, -0.72, -0.5, 0, 0.5, 0.72, 0.85, 1],
      rows: [
        [0.000, 0.000, 0.046, 0.095, 0.036],
        [0.030, 0.050, 0.049, 0.095, 0.038],
        [0.055, 0.140, 0.052, 0.095, 0.040],
        [0.080, 0.290, 0.054, 0.095, 0.043],
        [0.100, 0.480, 0.054, 0.095, 0.046],
        [0.118, 0.700, 0.054, 0.095, 0.048],
        [0.134, 0.900, 0.054, 0.095, 0.050],
        [0.146, 1.000, 0.054, 0.095, 0.050],
        [0.154, 0.984, 0.054, 0.092, 0.049],
        [0.161, 0.924, 0.054, 0.089, 0.048],
        [0.169, 0.807, 0.054, 0.087, 0.046],
        [0.176, 0.688, 0.054, 0.084, 0.045],
        [0.184, 0.569, 0.054, 0.081, 0.044],
        [0.191, 0.449, 0.054, 0.078, 0.043],
        [0.199, 0.341, 0.054, 0.075, 0.042],
        [0.206, 0.256, 0.054, 0.073, 0.041],
        [0.214, 0.189, 0.054, 0.070, 0.039],
        [0.221, 0.135, 0.054, 0.067, 0.038],
        [0.229, 0.091, 0.054, 0.064, 0.037],
        [0.236, 0.057, 0.054, 0.061, 0.036],
        [0.244, 0.032, 0.054, 0.058, 0.035],
        [0.251, 0.014, 0.054, 0.056, 0.033],
        [0.259, 0.003, 0.054, 0.053, 0.032],
        [0.266, 0.000, 0.054, 0.050, 0.031],
      ],
      shell: [
        [0.146, 1.000, 0.054, 0.095, 0.050],
        [0.176, 0.820, 0.054, 0.095, 0.050],
        [0.206, 0.600, 0.054, 0.095, 0.050],
        [0.236, 0.380, 0.054, 0.095, 0.050],
        [0.266, 0.180, 0.054, 0.095, 0.050],
        [0.286, 0.060, 0.054, 0.095, 0.050],
        [0.300, 0.000, 0.054, 0.095, 0.050],
      ],
      bridge: 0.8,
    },
    trunk: { bottom: 0.83, cz: -0.005, pivot: 1.28 },
    arm: [
      [0.150, 1.345, -0.005, 0.050], // shoulder pivot
      [0.163, 1.300, -0.008, 0.046],
      [0.184, 1.220, -0.012, 0.042],
      [0.208, 1.130, -0.012, 0.037],
      [0.230, 1.062, -0.010, 0.033], // elbow
      [0.243, 1.020, -0.006, 0.035],
      [0.268, 0.935, 0.000, 0.030],
      [0.300, 0.838, 0.006, 0.020], // wrist
    ],
    hand: [[0, 0.008, 0.019], [0.030, 0.019, 0.0165], [0.070, 0.025, 0.0135], [0.100, 0.024, 0.012], [0.135, 0.021, 0.010], [0.158, 0.014, 0.009], [0.170, 0.005, 0.008]],
    head: [
      [[0, 1.6241, -0.0313, 0.0723], [0, 1.6241, 0.0310, 0.0723]],
      [[0, 1.530, 0.012, 0.050], [0, 1.590, 0.012, 0.050]],
      [[0, 1.5280, 0.0000, 0.0420], [0, 1.5280, 0.0300, 0.0420]],
      [[0, 1.5317, -0.0010, 0.0429], [0, 1.5317, 0.0325, 0.0429]],
      [[0, 1.5370, -0.0023, 0.0442], [0, 1.5370, 0.0361, 0.0442]],
      [[0, 1.5433, -0.0040, 0.0459], [0, 1.5433, 0.0397, 0.0459]],
      [[0, 1.5500, -0.0060, 0.0480], [0, 1.5500, 0.0420, 0.0480]],
      [[0, 1.5557, -0.0078, 0.0502], [0, 1.5557, 0.0426, 0.0502]],
      [[0, 1.5619, -0.0099, 0.0528], [0, 1.5619, 0.0425, 0.0528]],
      [[0, 1.5684, -0.0122, 0.0557], [0, 1.5684, 0.0419, 0.0557]],
      [[0, 1.5752, -0.0146, 0.0585], [0, 1.5752, 0.0410, 0.0585]],
      [[0, 1.5820, -0.0170, 0.0610], [0, 1.5820, 0.0400, 0.0610]],
      [[0, 1.5878, -0.0192, 0.0629], [0, 1.5878, 0.0390, 0.0629]],
      [[0, 1.5937, -0.0215, 0.0647], [0, 1.5937, 0.0377, 0.0647]],
      [[0, 1.5998, -0.0239, 0.0665], [0, 1.5998, 0.0362, 0.0665]],
      [[0, 1.6059, -0.0263, 0.0681], [0, 1.6059, 0.0347, 0.0681]],
      [[0, 1.6120, -0.0283, 0.0697], [0, 1.6120, 0.0332, 0.0697]],
      [[0, 1.6180, -0.0300, 0.0710], [0, 1.6180, 0.0320, 0.0710]],
      [[0, 1.6304, -0.0322, 0.0735], [0, 1.6304, 0.0301, 0.0735]],
      [[0, 1.6366, -0.0329, 0.0746], [0, 1.6366, 0.0293, 0.0746]],
      [[0, 1.6427, -0.0334, 0.0754], [0, 1.6427, 0.0285, 0.0754]],
      [[0, 1.6486, -0.0338, 0.0759], [0, 1.6486, 0.0277, 0.0759]],
      [[0, 1.6540, -0.0340, 0.0760], [0, 1.6540, 0.0270, 0.0760]],
      [[0, 1.6618, -0.0339, 0.0749], [0, 1.6618, 0.0258, 0.0749]],
      [[0, 1.6692, -0.0333, 0.0728], [0, 1.6692, 0.0247, 0.0728]],
      [[0, 1.6756, -0.0325, 0.0705], [0, 1.6756, 0.0237, 0.0705]],
      [[0, 1.6800, -0.0320, 0.0690], [0, 1.6800, 0.0230, 0.0690]],
    ],
    joints: { hip: [0.900, 0.000], knee: [0.470, 0.012], ankle: [0.095, 0.006], shoulder: [1.345, -0.005], elbow: [1.062, -0.010] },
  },
  // Narrower pelvis, straight thick waist, less thigh taper, heavier knee, calf
  // and ankle, longer wider foot. The thigh gap (2 * hipX - 2 * top radius) stays positive.
  masculine: {
    label: 'Masculine',
    leg: [
      [0.900, 0.000, 0.082],
      [0.780, 0.004, 0.082],
      [0.640, 0.008, 0.076],
      [0.520, 0.010, 0.068],
      [0.470, 0.012, 0.063], // knee
      [0.420, 0.006, 0.058],
      [0.340, -0.006, 0.060], // calf
      [0.240, -0.006, 0.050],
      [0.150, -0.002, 0.041],
      [0.095, 0.006, 0.038], // ankle
      [0.0585, 0.0435, 0.0284],
      [0.0228, 0.1092, 0.0115],
      [0.0139, 0.1841, 0.0021], // in the second toe, on the line through the big and little toes' tips
    ],
    foot: {
      heel: [[0.0995, 0.0060, 0.0336], [0.0459, -0.0295, 0.0315]],
      rows: [
        [-0.0253, 0.0310, 0.0310, 0.0648, 0.0648, 0.0060, 0.0060],
        [-0.0190, 0.0353, 0.0353, 0.0690, 0.0690, 0.0060, 0.0060],
        [-0.0065, 0.0342, 0.0364, 0.0753, 0.0690, 0.0071, 0.0060],
        [0.0123, 0.0321, 0.0375, 0.0795, 0.0648, 0.0102, 0.0060],
        [0.0310, 0.0321, 0.0407, 0.0785, 0.0543, 0.0134, 0.0071],
        [0.0561, 0.0342, 0.0449, 0.0753, 0.0491, 0.0165, 0.0081],
        [0.0748, 0.0385, 0.0492, 0.0690, 0.0438, 0.0165, 0.0081],
        [0.0936, 0.0439, 0.0535, 0.0596, 0.0386, 0.0123, 0.0071],
        [0.1061, 0.0481, 0.0556, 0.0532, 0.0354, 0.0091, 0.0060],
        [0.1186, 0.0492, 0.0535, 0.0480, 0.0312, 0.0060, 0.0060],
        [0.1311, 0.0471, 0.0481, 0.0428, 0.0270, 0.0060, 0.0071],
        [0.1436, 0.0439, 0.0428, 0.0375, 0.0239, 0.0071, 0.0081],
        [0.1562, 0.0396, 0.0235, 0.0333, 0.0218, 0.0081, 0.0091],
      ],
      toes: [
        [[-0.0268, 0.0218, 0.1291, 0.0142], [-0.0225, 0.0191, 0.1728, 0.0126], [-0.0198, 0.0170, 0.1968, 0.0110]],
        [[-0.0021, 0.0197, 0.1270, 0.0095], [-0.0011, 0.0165, 0.1635, 0.0082], [0.0000, 0.0131, 0.1921, 0.0065]],
        [[0.0150, 0.0186, 0.1218, 0.0092], [0.0139, 0.0155, 0.1582, 0.0078], [0.0123, 0.0128, 0.1848, 0.0063]],
        [[0.0305, 0.0176, 0.1155, 0.0088], [0.0273, 0.0149, 0.1499, 0.0074], [0.0246, 0.0123, 0.1728, 0.0060]],
        [[0.0449, 0.0165, 0.1082, 0.0084], [0.0401, 0.0139, 0.1384, 0.0069], [0.0369, 0.0118, 0.1603, 0.0057]],
      ],
    },
    hipX: 0.088,
    knit: 0.0079572858,
    pelvis: [[[-0.065, 0.92, -0.005, 0.098], [0.065, 0.92, -0.005, 0.098]]],
    glutes: [[[-0.05, 0.905, -0.03, 0.09], [0.05, 0.905, -0.03, 0.09]]],
    waist: [
      [[-0.05, 0.95, 0, 0.1], [-0.05, 1.2, 0, 0.1]],
      [[0.05, 0.95, 0, 0.1], [0.05, 1.2, 0, 0.1]],
    ],
    torso: [
      [0.96, 0.050, 0, 0.100], // fills the crease between the two waist capsules
      [1.112, 0.050, 0, 0.100],
      [1.20, 0.050, 0, 0.100],
      [1.26, 0.064, 0, 0.100],
      [1.30, 0.090, 0, 0.096],
      [1.345, 0.116, 0, 0.078], // shoulder stump
      [1.375, 0.100, 0, 0.070],
      [1.40, 0.060, 0, 0.064],
    ],
    neck: [[1.40, 0.004, 0.064], [1.46, 0.008, 0.061], [1.53, 0.012, 0.058]],
    trunk: { bottom: 0.83, cz: -0.005, pivot: 1.28 },
    arm: [
      [0.170, 1.330, -0.005, 0.058], // shoulder pivot
      [0.184, 1.282, -0.008, 0.054],
      [0.207, 1.200, -0.012, 0.049],
      [0.232, 1.105, -0.012, 0.043],
      [0.252, 1.035, -0.010, 0.038], // elbow
      [0.265, 0.992, -0.006, 0.041],
      [0.290, 0.905, 0.000, 0.036],
      [0.320, 0.800, 0.006, 0.024], // wrist
    ],
    hand: [[0, 0.010, 0.022], [0.032, 0.022, 0.019], [0.075, 0.029, 0.016], [0.108, 0.028, 0.0145], [0.145, 0.024, 0.012], [0.170, 0.016, 0.011], [0.182, 0.006, 0.010]],
    head: [
      [[0, 1.6304, -0.0333, 0.0773], [0, 1.6304, 0.0338, 0.0773]],
      [[0, 1.530, 0.012, 0.058], [0, 1.590, 0.012, 0.058]],
      [[0, 1.5280, 0.0000, 0.0480], [0, 1.5280, 0.0320, 0.0480]],
      [[0, 1.5321, -0.0009, 0.0489], [0, 1.5321, 0.0349, 0.0489]],
      [[0, 1.5379, -0.0023, 0.0503], [0, 1.5379, 0.0391, 0.0503]],
      [[0, 1.5447, -0.0039, 0.0519], [0, 1.5447, 0.0433, 0.0519]],
      [[0, 1.5520, -0.0060, 0.0540], [0, 1.5520, 0.0460, 0.0540]],
      [[0, 1.5570, -0.0076, 0.0557], [0, 1.5570, 0.0467, 0.0557]],
      [[0, 1.5624, -0.0095, 0.0576], [0, 1.5624, 0.0468, 0.0576]],
      [[0, 1.5681, -0.0115, 0.0597], [0, 1.5681, 0.0464, 0.0597]],
      [[0, 1.5740, -0.0136, 0.0619], [0, 1.5740, 0.0458, 0.0619]],
      [[0, 1.5800, -0.0158, 0.0640], [0, 1.5800, 0.0449, 0.0640]],
      [[0, 1.5860, -0.0180, 0.0660], [0, 1.5860, 0.0440, 0.0660]],
      [[0, 1.5921, -0.0203, 0.0678], [0, 1.5921, 0.0429, 0.0678]],
      [[0, 1.5984, -0.0229, 0.0697], [0, 1.5984, 0.0414, 0.0697]],
      [[0, 1.6047, -0.0255, 0.0714], [0, 1.6047, 0.0398, 0.0714]],
      [[0, 1.6112, -0.0280, 0.0731], [0, 1.6112, 0.0380, 0.0731]],
      [[0, 1.6176, -0.0302, 0.0746], [0, 1.6176, 0.0364, 0.0746]],
      [[0, 1.6240, -0.0320, 0.0760], [0, 1.6240, 0.0350, 0.0760]],
      [[0, 1.6370, -0.0343, 0.0785], [0, 1.6370, 0.0327, 0.0785]],
      [[0, 1.6436, -0.0350, 0.0796], [0, 1.6436, 0.0317, 0.0796]],
      [[0, 1.6501, -0.0355, 0.0805], [0, 1.6501, 0.0307, 0.0805]],
      [[0, 1.6562, -0.0358, 0.0810], [0, 1.6562, 0.0298, 0.0810]],
      [[0, 1.6620, -0.0360, 0.0810], [0, 1.6620, 0.0290, 0.0810]],
      [[0, 1.6687, -0.0360, 0.0801], [0, 1.6687, 0.0280, 0.0801]],
      [[0, 1.6753, -0.0355, 0.0784], [0, 1.6753, 0.0271, 0.0784]],
      [[0, 1.6813, -0.0349, 0.0762], [0, 1.6813, 0.0262, 0.0762]],
      [[0, 1.6864, -0.0344, 0.0743], [0, 1.6864, 0.0255, 0.0743]],
      [[0, 1.6900, -0.0340, 0.0730], [0, 1.6900, 0.0250, 0.0730]],
    ],
    joints: { hip: [0.900, 0.000], knee: [0.470, 0.012], ankle: [0.095, 0.006], shoulder: [1.330, -0.005], elbow: [1.035, -0.010] },
  },
};

// color: sRGB albedo. scatter: how far each channel's light wraps past the shadow terminator, as a colour so red
// reaches furthest; main.js scales it (linear) by SKIN.wrap. Darker skin absorbs more, so its scatter is darker.
export const SKIN_TONES = [
  { id: 'very-light', label: 'Very light', color: '#f1d4c2', scatter: '#e8806a' },
  { id: 'light', label: 'Light', color: '#e8bfa1', scatter: '#e07058' },
  { id: 'light-medium', label: 'Light medium', color: '#d6a07c', scatter: '#d4624a' },
  { id: 'medium', label: 'Medium', color: '#b97f58', scatter: '#c0502f' },
  { id: 'brown', label: 'Brown', color: '#8a5a3c', scatter: '#a8401f' },
  { id: 'deep', label: 'Deep', color: '#5a3a28', scatter: '#8a2f18' },
];

const RAINBOW = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'];

export const STOCKING_COLORS = [
  { id: 'black', label: 'Black', color: '#0d0d12', sheen: '#9aa0b4' },
  { id: 'charcoal', label: 'Charcoal', color: '#3a3b40', sheen: '#a8acb8' },
  { id: 'nude', label: 'Nude', color: '#c79a7e', sheen: '#f0dcc8' },
  { id: 'white', label: 'White', color: '#f2f0ec', sheen: '#ffffff' },
  { id: 'navy', label: 'Navy', color: '#14203f', sheen: '#8fa0d0' },
  { id: 'burgundy', label: 'Burgundy', color: '#4a0f1c', sheen: '#c08a98' },
  // Patterned entries use the colourway shape. The stocking mesh has no seam, so bands run only along its length.
  { id: 'bw-stripe', label: 'Black and white stripe', pattern: 'stripes', colors: ['#0d0d12', '#f2f0ec'], count: 24, sheen: '#ffffff' },
  { id: 'red-black', label: 'Red and black stripe', pattern: 'stripes', colors: ['#b3202e', '#0d0d12'], count: 24, sheen: '#e8a0a8' },
  { id: 'rainbow', label: 'Rainbow stripe', pattern: 'stripes', colors: RAINBOW, count: 18, sheen: '#ffffff' },
];

// base: cloth colour. dark / light: broad bands. line: thin accent stripes.
export const SKIRT_COLORS = [
  { id: 'charcoal', label: 'Charcoal', base: '#2b2b30', dark: '#000000', light: '#ffffff', line: '#ffffff' },
  { id: 'navy', label: 'Navy', base: '#1f2c52', dark: '#050a1c', light: '#9db4ff', line: '#d8e0ff' },
  { id: 'red', label: 'Red tartan', base: '#9a1d28', dark: '#1a0508', light: '#ffd9a0', line: '#ffe27a' },
  { id: 'green', label: 'Forest green', base: '#1f4a34', dark: '#04140c', light: '#b6e0a8', line: '#f0e6a0' },
  { id: 'tan', label: 'Tan', base: '#b89a72', dark: '#3a2814', light: '#fff0d0', line: '#6a4a2a' },
];

// Shirt rows: top and hem are heights in metres. A `flat` top is a horizontal ring at that height. Otherwise
// the top ring runs over the shoulders and `top` is the height of its front point (neck base 1.39, on the neck
// 1.50). Every style is a sleeveless closed tube cut without the arms, which emerge through it at the shoulder.
export const SHIRT_STYLES = [
  { id: 'none', label: 'None' },
  { id: 'tube', label: 'Tube', top: 1.33, hem: 1.14, flat: true },
  { id: 'crop', label: 'Crop', top: 1.39, hem: 1.14 },
  { id: 'tank', label: 'Tank', top: 1.39, hem: 0.99 },
  { id: 'turtleneck', label: 'Turtleneck', top: 1.50, hem: 0.99 },
];

// How garments answer the moving body. inertia: share of the body's local acceleration the fabric resists (the rest
// is carried by skin contact and the knit's grip, so tight nylon is low and a free skirt is 1). drag: quadratic
// air drag against still air, 1/m, about rho * Cd / (2 * areal density) for a fabric broadside to the air.
export const STOCKING_MOTION = { inertia: 0.03, drag: 0 };
export const SKIRT_MOTION = { inertia: 1, drag: 2.5 };
export const SHIRT_MOTION = { inertia: 0.4, drag: 1 };

// offset + thickness must stay under the skirt's thickness (0.005) so a tucked tank sits beneath it.
export const SHIRT = {
  offset: 0.0025, thickness: 0.0015, pitch: 0.012, nseg: 64,
  params: { compliance: [1e-5, 2e-5, 0], homeK: 45 * 45, damping: 9, friction: 0.3, ...SHIRT_MOTION },
};

const tint = (id, label, color) => ({ id, label, pattern: 'solid', colors: [color] });
export const SHIRT_COLORS = [
  tint('white', 'White', '#f4f2ee'),
  tint('black', 'Black', '#1b1b1f'),
  tint('red', 'Red', '#b3202e'),
  tint('navy', 'Navy', '#1f2c52'),
  tint('sage', 'Sage', '#8ea58c'),
  tint('mustard', 'Mustard', '#d9a62b'),
  { id: 'breton', label: 'Breton stripe', pattern: 'stripes', colors: ['#1f2c52', '#f4f2ee'], count: 14 },
  { id: 'candy', label: 'Candy stripe', pattern: 'stripes', colors: ['#c62839', '#f4f2ee'], count: 14 },
  { id: 'block', label: 'Color block', pattern: 'block', colors: ['#1f2c52', '#f4f2ee', '#c62839'] },
  { id: 'sunset', label: 'Sunset ombre', pattern: 'ombre', colors: ['#ffb86b', '#ff6f91', '#7b4fb8'] },
  { id: 'rainbow', label: 'Rainbow stripe', pattern: 'stripes', colors: RAINBOW, count: 6 },
];

// width: band height in metres. ornament: a metal piece hung at the front (+z).
export const CHOKER_STYLES = [
  { id: 'none', label: 'None' },
  { id: 'ribbon', label: 'Ribbon', width: 0.008 },
  { id: 'band', label: 'Band', width: 0.018 },
  { id: 'ring', label: 'Ring', width: 0.018, ornament: 'ring' },
  { id: 'pendant', label: 'Pendant', width: 0.008, ornament: 'gem' },
];

// The band sits just outside the turtleneck fabric.
export const CHOKER = { y: 1.47, offset: SHIRT.offset + SHIRT.thickness + 0.001, nseg: 96 };

export const CHOKER_COLORS = [
  tint('black', 'Black', '#121216'),
  tint('white', 'White', '#f4f2ee'),
  tint('red', 'Red', '#b3202e'),
  tint('navy', 'Navy', '#1f2c52'),
  { id: 'bw', label: 'Black and white stripe', pattern: 'stripes', colors: ['#121216', '#f4f2ee'], count: 8 },
  { id: 'pastel', label: 'Pastel ombre', pattern: 'ombre', colors: ['#ffc2d6', '#c3b1ff', '#a8e0ff'] },
  { id: 'rainbow', label: 'Rainbow stripe', pattern: 'stripes', colors: RAINBOW, count: 6 },
];

// thigh, glute, chest: 0..1 build sliders.
export const DEFAULTS = {
  body: 'feminine', skin: 'light-medium', stocking: 'black', skirt: 'charcoal',
  shirt: 'tank', shirtColor: 'white', choker: 'band', chokerColor: 'black', thigh: 0, glute: 0, chest: 0.5, motion: 'stand',
};

// Tuning for the thigh and glute modifiers and the squeeze under the stocking band. Metres.
export const BUILD = {
  thigh: { gain: 0.28, from: 0.50, to: 0.66 }, // radius gain, ramping in between knee and mid thigh
  glute: { gain: 0.32, back: 0.03 },
  // projection: how far the bust stands off the ribcage, metres, a + b * size + c * size ^ 2. It measures 4.5 mm at 0,
  // 45 at 0.5 and 90 full. flat: the share of the full size that width, drop and radius keep at size 0. step: row spacing.
  // grid: the torso skin of a body with a chest, rings by columns. Column angle t moves to t + a sin 2t + b cos t for
  // crowd [a, b], packing columns over the bust while keeping one on the midline. Ring spacing also follows the arc
  // length along the ray toward probe [x, z] and its mirror, so rings stay close over the bust's front.
  // bounce: the bust as a damped spring in y and z, driven by the chest's acceleration. hz: natural frequency at size
  // 0 and 1. damping: damping ratio. gain: share of the compressed acceleration it answers, per metre of projection, so
  // a small bust barely moves. drive: low-pass cutoff on the acceleration, Hz: the walk's root stutters by a few mm at
  // each foot change, and take-off stops the torso's lean within a frame; at 5 Hz the compressed stutter still hitched
  // the walk's swing. knee: m/s^2, the low-passed acceleration's size past which it compresses, for an upward one and a
  // downward one, so a walk's small accelerations answer at the full gain and a jump's large ones level off. The
  // downward knee is lower because a downward acceleration floats the bust up, in a jump's flight toward arms that pass
  // 5.6 mm from it at the landing, and because the walk's long downward arcs, compressed as little as its short upward
  // kicks at the foot changes, held a full bust 1.8 mm up for as long as it walked. ratio: past the knee the acceleration
  // grows at 1 / ratio of its slope, so an extreme one still reaches the limit. limit: the offset saturates smoothly
  // toward this share of the projection. rest: under this offset in metres, and the speed it would cover in a radian of
  // the swing, it snaps to rest. blend: depth in metres over which a point between two capsules mixes their weights.
  chest: {
    projection: [0.0056, 0.0807, 0.0065], flat: 0.62, step: 0.0075, grid: { rings: 120, segs: 96, crowd: [0.1, 0.27], probe: [0.066, 0.12] },
    bounce: { hz: [2.6, 2.2], damping: 0.33, gain: 20, drive: 3, knee: [1.7, 0.5], ratio: 25, limit: 0.25, rest: 1e-4, blend: 0.004 },
  },
  // probes: rays per ring that measure the foot's section for its columns. top: how much denser columns run over
  // the top than the sides, exp(top) times, and the sole exp(-top). turn: the centre line's horizontal share over
  // which columns blend from even angles to the foot's.
  // groove: how far under the tops of two neighbouring toes the stocking's rest shape bridges them, at their roots.
  // cap: how far behind the toes' front the stocking's last ring stands before its cap closes over them.
  // wrap: rounds of smoothing that pull the knit across the foot's hollows, the share of the way to the neighbours'
  // mean each round moves a point, and the rings over which that share ramps in. face: how far every point of the
  // knit's triangles over the foot stays off the union at rest.
  foot: { probes: 64, top: 0.7, turn: [0.3, 0.7], groove: 0.0015, cap: 0.004, wrap: { rounds: 10, pull: 0.5, ramp: 4 }, face: 0.001 },
  squeeze: {
    below: 0.07, above: 0.06, // refined window around the band's top edge
    maxPiece: 0.005,
    openBelow: 0.8, thighPiece: 0.012, // flat-ended pieces run from the top of the knee's pose blend to here; see buildLeg
    dig0: 0.0012, softness: 0.3, // band depth = dig0 + softness * thickness gained
    sheerShare: 0.3,              // the leg of the stocking compresses less than the band
    edge: 0.007,
    bulgeShare: 0.5, bulgeAt: 0.016, bulgeWidth: 0.018, // flesh pushed up above the band
  },
};

// Blend widths of the pose field, metres. knee, ankle, elbow: half width of the blend centred on the pivot.
// own: half width of the hip share's blend on (distance to the nearer leg - distance to the torso).
// ramp: frames a held pose takes to arrive. The garments follow the root, so a thigh that jumps straight
// into a crouch lands 5 to 7 cm inside the skirt, which then thrashes; over 5 to 30 frames the skirt settles.
// toe: width of the toes' blend, starting at the line through their roots and running forward. toeMax: the most a
// motion bends the toes up, degrees, to keep them on the floor as the heel rises.
export const POSE = { knee: 0.07, ankle: 0.04, elbow: 0.05, toe: 0.02, toeMax: 60, own: 0.01, ramp: 15 };

// Motions, in degrees and seconds, read by motion.js. A cycle motion keys each joint of the left side over one
// gait cycle from left heel strike ([phase, degrees], interpolated periodically); the right side runs half a cycle
// later. Arms swing opposite to the leg on their side. stance: the left foot's floor contact, heel strike to toe-off.
// Through double support one root height must rest two feet, so the trailing ankle is solved: over `push`
// [from, full from, full to, to] it plantarflexes (a longer reach) or the knee bends (a shorter one), within `reach`
// [ankle, knee] degrees, until the trailing foot is level with the leading one, changing at most `rate` degrees/s.
// Feet are measured standing on the ball, as the toes bend up to stay on the floor (POSE.toeMax).
// A jump drives one crouch value c: crouch holds the angles at c = 1, point those at c = -1 (toes pointed, arms
// up), and each part eases in across c = +-blend, so standing (c near 0) bends a little of both. While crouching
// the ankle keeps the foot flat. phases: the cycle as crouch values reached in turn, in `t` seconds each, each
// starting where the one before ends, on the floor and at rest at both ends except at take-off (the end of the phase
// before the flight) and landing (the start of the one after). The flight is ballistic to the root height `apex`,
// its length set by gravity, with the legs reaching c at its middle and returning to take-off's c. The push and the
// absorb are as short as they are because the pointed foot stands on its ball with the toes flat, which puts the root
// 12 to 22 mm lower at take-off than the toeless foot did (measured), so they cover less height at the flight's speed
// and longer ones overshoot.
export const MOTIONS = {
  stand: { label: 'Stand' },
  walk: {
    label: 'Walk', kind: 'cycle', cadence: 1.8, lean: 3, stance: [0, 0.6], push: [0.42, 0.48, 0.6, 0.66], reach: [-12, 8], rate: 300,
    hip: [[0, 17], [0.05, 17], [0.12, 19], [0.3, 5.5], [0.45, -10], [0.5, -13.5], [0.55, -14], [0.6, -8], [0.7, 4.5], [0.8, 20.5], [0.88, 24.5], [0.95, 22]],
    knee: [[0, 6], [0.05, 9], [0.1, 15], [0.2, 15], [0.35, 8.5], [0.45, 5], [0.5, 12.5], [0.55, 19.5], [0.6, 30], [0.67, 50], [0.74, 60], [0.86, 35.5], [0.95, 4.5]],
    ankle: [[0, 3.5], [0.05, -5], [0.1, -6], [0.3, 5], [0.45, 10], [0.5, 4], [0.55, -4], [0.6, -12], [0.67, -14.5], [0.75, -0.5], [0.85, 3], [0.93, -2.5]],
    shoulder: [[0, -14], [0.5, 14]],
    elbow: [[0, 10], [0.5, 24]],
  },
  jump: {
    label: 'Jump', kind: 'jump', apex: 0.29, blend: 0.3,
    crouch: { hip: 75, knee: 70, lean: 25, shoulder: -50, elbow: 15 },
    point: { ankle: -40, shoulder: 130, elbow: 10 },
    phases: [
      { name: 'ready', c: 0.1, t: 0.15 },
      { name: 'dip', c: 1, t: 0.4 },
      { name: 'push', c: -0.75, t: 0.23 },
      { name: 'flight', c: -1, flight: true },
      { name: 'absorb', c: 0.95, t: 0.22 },
      { name: 'rise', c: 0.1, t: 0.45 },
    ],
  },
};
// Seconds a motion's amplitude takes to blend in or out.
export const MOTION_BLEND = 0.3;

// Default camera and the studio. follow: the view rises by `share` of the root's height above standing, eased
// over `lag` seconds, so a jump's apex keeps the head in frame. shadow: the key light's shadow box, wide enough
// for the figure at the apex with the arms up. Colours are sRGB.
// key.softness: tangent of the key's angular radius, so a penumbra is that times the blocker-to-receiver
// distance; key.maxBlur caps the penumbra radius in metres. env: the room PMREM blurs into reflections and
// ambient, with softboxes placed by direction (`key` is the key light's) and distance. cyc: the backdrop, a floor
// that curves up into a wall all round; `pool` metres is how far the lit area reaches before it falls to `edge`,
// and `lift` is the share of its colour it shows unlit, as backdrop lights would keep the wall away from the key
// from going murky.
// contact: how strongly the feet and shins darken the floor's ambient light.
export const VIEW = {
  fov: 32, camera: [1.43, 1.26, 3.63], target: [0, 0.93, 0],
  follow: { share: 0.5, lag: 0.3 },
  light: [1.2, 2.4, 1.6],
  shadow: { left: -1, right: 1, top: 1.7, bottom: -0.2, near: 1, far: 8 },
  exposure: 1.0,
  key: { color: '#fff4ea', intensity: 2.5, softness: 0.07, maxBlur: 0.12 },
  fill: { color: '#d4e0ff', intensity: 0.4, at: [-2.2, 0.6, 1.6] },
  rim: { color: '#fff6ee', intensity: 1.0, at: [-0.8, 1.6, -2.4] },
  env: {
    intensity: 0.8, floor: '#b8b6b2', wall: '#a4a3a1', ceiling: '#83838a',
    boxes: [
      { at: 'key', distance: 6, size: [2.6, 3.2], color: '#fff3e6', intensity: 3 },
      { at: [-2.2, 0.6, 1.6], distance: 6, size: [1.4, 3.6], color: '#dfe8ff', intensity: 2.2 },
      { at: [-1.2, 0.8, -2.4], distance: 6, size: [0.6, 4], color: '#ffffff', intensity: 4 },
      { at: [1.4, 0.8, -2.2], distance: 6, size: [0.6, 4], color: '#ffffff', intensity: 3 },
    ],
  },
  cyc: { radius: 7, fillet: 2.4, height: 14, color: '#d8d8d8', pool: 4.5, edge: 0.7, lift: 0.14 },
  contact: { strength: 0.85 },
};
