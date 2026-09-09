// Compile only the scalar 3D float implementation; reject other requested modes.
#include "antsCommandLineParser.h"
#include <iostream>
namespace ants {
using Parser = itk::ants::CommandLineParser;
int unsupported() { std::cerr << "This build supports only 3D float registration (--dimensionality 3 --float 1)." << std::endl; return 1; }
int antsRegistration2DFloat(Parser::Pointer&) { return unsupported(); }
int antsRegistration4DFloat(Parser::Pointer&) { return unsupported(); }
int antsRegistration2DDouble(Parser::Pointer&) { return unsupported(); }
int antsRegistration3DDouble(Parser::Pointer&) { return unsupported(); }
int antsRegistration4DDouble(Parser::Pointer&) { return unsupported(); }
}
