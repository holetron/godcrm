import 'dart:math' as math;

import 'package:flutter/material.dart';
import '../../core/theme.dart';

/// Animated boot/loading screen for GOD CRM.
///
/// A single transparent ring sprite (`assets/splash/spinner_ring.png`) is
/// spun in code and tilted back in 3D to match the [TorusBrand] HUD ring on
/// the web login/landing page (`perspective: 1000px` + `rotateX(18deg)`) so
/// the boot screen and the login screen share the same viewing angle. The
/// "GOD CRM" wordmark is drawn as static, upright text in the center — exactly
/// like the login torus, where the wordmark sits flat in front of the tilted
/// ring. No GIF, no per-frame assets: one small PNG + a code-driven transform
/// keeps runtime weight near zero.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  /// Back-tilt of the ring, matching `rotateX(18deg)` on the web TorusBrand.
  static const double _tiltRadians = 18 * math.pi / 180;

  /// Perspective foreshortening — Flutter's equivalent of CSS
  /// `perspective: 1000px` is a (3,2) matrix entry of 1/1000.
  static const double _perspective = 0.001;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: GodTheme.background,
      body: Center(
        child: Stack(
          alignment: Alignment.center,
          children: [
            // Spinning ring — tilted back 18° in 3D (same angle as the web
            // login TorusBrand) while spinning in its own plane underneath.
            // The tilt is fixed; only the in-plane spin is animated, so the
            // flat sprite reads as a HUD disc lying at the login's angle.
            AnimatedBuilder(
              animation: _controller,
              builder: (context, child) {
                final transform = Matrix4.identity()
                  ..setEntry(3, 2, _perspective) // perspective: 1000px
                  ..rotateX(_tiltRadians) //        fixed back-tilt
                  ..rotateZ(_controller.value * 2 * math.pi); // in-plane spin
                return Transform(
                  alignment: Alignment.center,
                  transform: transform,
                  child: child,
                );
              },
              child: Image.asset(
                'assets/splash/spinner_ring.png',
                width: 200,
                height: 200,
                filterQuality: FilterQuality.none, // keep crisp 8-bit edges
              ),
            ),
            // Static wordmark — kept OUT of RotationTransition so the
            // letters stay upright while the ring spins behind them.
            Text(
              'GOD CRM',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 18,
                fontWeight: FontWeight.w700,
                letterSpacing: 2.0,
                color: GodTheme.accent, // cyan, matches the ring
              ),
            ),
          ],
        ),
      ),
    );
  }
}
