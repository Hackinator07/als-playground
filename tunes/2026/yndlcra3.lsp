(("CarSetup"
  Car
  ("Car"
   MaxSteeringLock					0.75
   FrontRollBarStiffness			10000
   RearRollBarStiffness				10500
   )
  Drive
  (":-D"
   FrontDiffMaxTorque				90.0
   CenterDiffMaxTorque				3000.0
   RearDiffMaxTorque				120.0

   MaxBrakePressureFront			4090000
   MaxBrakePressureRear				2450000
   HandbrakePercentage_NGP			0.75

   GearId0							1
   GearId1							2
   GearId2							3
   GearId3							4
   GearId4							5
   GearId5							6
   GearId6							7
   GearId7							8
   FinalDriveId						9

   DropGearId						11

   HighSpeedBreakReboundFront_NGP	0.30
   HighSpeedDampingReboundFront_NGP 3670

   HighSpeedBreakReboundRear_NGP	0.30
   HighSpeedDampingReboundRear_NGP	3760

   BumpStopStiffnessFront_NGP		168000
   BumpStopDampingBumpFront_NGP		15250
   BumpStopDampingReboundFront_NGP	16750

   BumpStopStiffnessRear_NGP		172500
   BumpStopDampingBumpRear_NGP		15500
   BumpStopDampingReboundRear_NGP	17250
   )
  Engine
  (":-D"
   Features_NGP						1
   )
  VehicleControlUnit
  (":-D"
   CenterDiffHandbrakeRelease		0.5
   LeftFootBrakeThreshold			0.2

   CenterDiffThrottle_00			0.0000
   CenterDiffThrottle_01			0.0500
   CenterDiffThrottle_02			0.0725
   CenterDiffThrottle_03			0.1000
   CenterDiffThrottle_04			0.1500
   CenterDiffThrottle_05			0.2000
   CenterDiffThrottle_06			0.3000
   CenterDiffThrottle_07			0.4000
   CenterDiffThrottle_08			0.5500
   CenterDiffThrottle_09			0.7500
   CenterDiffThrottle_10			1.0000

   CenterDiffBrake_00				0.0000
   CenterDiffBrake_01				0.0500
   CenterDiffBrake_02				0.1000
   CenterDiffBrake_03				0.2000
   CenterDiffBrake_04				0.3500
   CenterDiffBrake_05				0.5000
   CenterDiffBrake_06				0.7000
   CenterDiffBrake_07				1.0000
   CenterDiffBrake_08				1.0000
   CenterDiffBrake_09				1.0000
   CenterDiffBrake_10				1.0000


   CenterSpeedMapVelocity_00		0.00			CenterSpeedMapFactor_00			0.0
   CenterSpeedMapVelocity_01		5.56			CenterSpeedMapFactor_01			0.0
   CenterSpeedMapVelocity_02		11.1			CenterSpeedMapFactor_02			0.0
   CenterSpeedMapVelocity_03		16.7			CenterSpeedMapFactor_03			0.0
   CenterSpeedMapVelocity_04		22.2			CenterSpeedMapFactor_04			0.0
   CenterSpeedMapVelocity_05		27.8			CenterSpeedMapFactor_05			0.0
   CenterSpeedMapVelocity_06		33.3			CenterSpeedMapFactor_06			0.0
   CenterSpeedMapVelocity_07		38.9			CenterSpeedMapFactor_07			0.0
   CenterSpeedMapVelocity_08		44.4			CenterSpeedMapFactor_08			0.0
   CenterSpeedMapVelocity_09		50.0			CenterSpeedMapFactor_09			0.0
   CenterSpeedMapVelocity_10		55.6			CenterSpeedMapFactor_10			0.0

   LFCenterDiffThrottle_00			0.0000
   LFCenterDiffThrottle_01			0.0500
   LFCenterDiffThrottle_02			0.0725
   LFCenterDiffThrottle_03			0.1000
   LFCenterDiffThrottle_04			0.1500
   LFCenterDiffThrottle_05			0.2000
   LFCenterDiffThrottle_06			0.3000
   LFCenterDiffThrottle_07			0.4000
   LFCenterDiffThrottle_08			0.5500
   LFCenterDiffThrottle_09			0.7500
   LFCenterDiffThrottle_10			1.0000

   LFCenterDiffBrake_00				0.0
   LFCenterDiffBrake_01				0.0
   LFCenterDiffBrake_02				0.0
   LFCenterDiffBrake_03				0.0
   LFCenterDiffBrake_04				0.0500
   LFCenterDiffBrake_05				0.1500
   LFCenterDiffBrake_06				0.2500
   LFCenterDiffBrake_07				0.3500
   LFCenterDiffBrake_08				0.5000
   LFCenterDiffBrake_09				0.7000
   LFCenterDiffBrake_10				1.0000

   LFCenterSpeedMapVelocity_00		0.00			LFCenterSpeedMapFactor_00		0.0
   LFCenterSpeedMapVelocity_01		5.56			LFCenterSpeedMapFactor_01		0.0
   LFCenterSpeedMapVelocity_02		11.1			LFCenterSpeedMapFactor_02		0.0
   LFCenterSpeedMapVelocity_03		16.7			LFCenterSpeedMapFactor_03		0.0
   LFCenterSpeedMapVelocity_04		22.2			LFCenterSpeedMapFactor_04		0.0
   LFCenterSpeedMapVelocity_05		27.8			LFCenterSpeedMapFactor_05		0.0
   LFCenterSpeedMapVelocity_06		33.3			LFCenterSpeedMapFactor_06		0.0
   LFCenterSpeedMapVelocity_07		38.9			LFCenterSpeedMapFactor_07		0.0
   LFCenterSpeedMapVelocity_08		44.4			LFCenterSpeedMapFactor_08		0.0
   LFCenterSpeedMapVelocity_09		50.0			LFCenterSpeedMapFactor_09		0.0
   LFCenterSpeedMapVelocity_10		55.6			LFCenterSpeedMapFactor_10		0.0

   FrontDiffThrottle_00				0.30
   FrontDiffThrottle_01				0.0
   FrontDiffThrottle_02				0.0
   FrontDiffThrottle_03				0.0
   FrontDiffThrottle_04				0.0
   FrontDiffThrottle_05				0.0
   FrontDiffThrottle_06				0.0
   FrontDiffThrottle_07				0.0
   FrontDiffThrottle_08				0.0
   FrontDiffThrottle_09				0.0
   FrontDiffThrottle_10				0.0

   FrontDiffBrake_00				0.20
   FrontDiffBrake_01				0.0
   FrontDiffBrake_02				0.0
   FrontDiffBrake_03				0.0
   FrontDiffBrake_04				0.0
   FrontDiffBrake_05				0.0
   FrontDiffBrake_06				0.0
   FrontDiffBrake_07				0.0
   FrontDiffBrake_08				0.0
   FrontDiffBrake_09				0.0
   FrontDiffBrake_10				0.0

   FrontSpeedMapVelocity_00			0.00			FrontSpeedMapFactor_00			0.0
   FrontSpeedMapVelocity_01			2.78			FrontSpeedMapFactor_01			0.0
   FrontSpeedMapVelocity_02			5.56			FrontSpeedMapFactor_02			0.0
   FrontSpeedMapVelocity_03			8.33			FrontSpeedMapFactor_03			0.0
   FrontSpeedMapVelocity_04			11.1			FrontSpeedMapFactor_04			0.0
   FrontSpeedMapVelocity_05			13.8			FrontSpeedMapFactor_05			0.0
   FrontSpeedMapVelocity_06			16.7			FrontSpeedMapFactor_06			0.0
   FrontSpeedMapVelocity_07			22.2			FrontSpeedMapFactor_07			0.0
   FrontSpeedMapVelocity_08			27.7			FrontSpeedMapFactor_08			0.0
   FrontSpeedMapVelocity_09			38.9			FrontSpeedMapFactor_09			0.0
   FrontSpeedMapVelocity_10			55.6			FrontSpeedMapFactor_10			0.0

   RearDiffThrottle_00				0.50
   RearDiffThrottle_01				0.0
   RearDiffThrottle_02				0.0
   RearDiffThrottle_03				0.0
   RearDiffThrottle_04				0.0
   RearDiffThrottle_05				0.0
   RearDiffThrottle_06				0.0
   RearDiffThrottle_07				0.0
   RearDiffThrottle_08				0.0
   RearDiffThrottle_09				0.0
   RearDiffThrottle_10				0.0

   RearDiffBrake_00					0.45
   RearDiffBrake_01					0.0
   RearDiffBrake_02					0.0
   RearDiffBrake_03					0.0
   RearDiffBrake_04					0.0
   RearDiffBrake_05					0.0
   RearDiffBrake_06					0.0
   RearDiffBrake_07					0.0
   RearDiffBrake_08					0.0
   RearDiffBrake_09					0.0
   RearDiffBrake_10					0.0

   RearSpeedMapVelocity_00			0.00			RearSpeedMapFactor_00			0.0
   RearSpeedMapVelocity_01			5.56			RearSpeedMapFactor_01			0.0
   RearSpeedMapVelocity_02			11.1			RearSpeedMapFactor_02			0.0
   RearSpeedMapVelocity_03			16.7			RearSpeedMapFactor_03			0.0
   RearSpeedMapVelocity_04			22.2			RearSpeedMapFactor_04			0.0
   RearSpeedMapVelocity_05			27.8			RearSpeedMapFactor_05			0.0
   RearSpeedMapVelocity_06			33.3			RearSpeedMapFactor_06			0.0
   RearSpeedMapVelocity_07			38.9			RearSpeedMapFactor_07			0.0
   RearSpeedMapVelocity_08			44.4			RearSpeedMapFactor_08			0.0
   RearSpeedMapVelocity_09			50.0			RearSpeedMapFactor_09			0.0
   RearSpeedMapVelocity_10			55.6			RearSpeedMapFactor_10			0.0
   )

  WheelLF
  (":-D"
   TopMountSlot						3
   SteeringRodLength				+0.455720
   StrutPlatformHeight				0.000000
   WheelAxisInclination				-0.073090
   )

  WheelRF
  (":-D"
   TopMountSlot						3
   SteeringRodLength				+0.455720
   StrutPlatformHeight				0.000000
   WheelAxisInclination				-0.073090
   )

  WheelLB
  (":-D"
   TopMountSlot						0
   SteeringRodLength				+0.510000
   StrutPlatformHeight				0.000000
   WheelAxisInclination				-0.012669
   )

  WheelRB
  (":-D"
   TopMountSlot						0
   SteeringRodLength				+0.510000
   StrutPlatformHeight				0.000000
   WheelAxisInclination				-0.012669
   )

  SpringDamperLF
  (":-D"
   SpringLength						0.310
   SpringStiffness					27200
   HelperSpringMinLength			0.056
   HelperSpringLength				0.140
   HelperSpringStiffness			20400
   DampingBump						3970
   DampingRebound					4280
   BumpHighSpeedBreak				0.30
   DampingBumpHighSpeed				3060
   )

  SpringDamperRF
  (":-D"
   SpringLength						0.310
   SpringStiffness					27200
   HelperSpringMinLength			0.056
   HelperSpringLength				0.140
   HelperSpringStiffness			20400
   DampingBump						3970
   DampingRebound					4280
   BumpHighSpeedBreak				0.30
   DampingBumpHighSpeed				3060
   )

  SpringDamperLB
  (":-D"
   SpringLength						0.310
   SpringStiffness					28000
   HelperSpringMinLength			0.058
   HelperSpringLength				0.145
   HelperSpringStiffness			21000
   DampingBump						4070
   DampingRebound					4380
   BumpHighSpeedBreak				0.30
   DampingBumpHighSpeed				3130
   )

  SpringDamperRB
  (":-D"
   SpringLength						0.310
   SpringStiffness					28000
   HelperSpringMinLength			0.058
   HelperSpringLength				0.145
   HelperSpringStiffness			21000
   DampingBump						4070
   DampingRebound					4380
   BumpHighSpeedBreak				0.30
   DampingBumpHighSpeed				3130
   )

  TyreLF
  (":-D"
   Pressure							220000
   )
  TyreRF
  (":-D"
   Pressure							220000
   )
  TyreLB
  (":-D"
   Pressure							220000
   )
  TyreRB
  (":-D"
   Pressure							220000
   )
))
