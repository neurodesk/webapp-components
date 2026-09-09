#include <vector>
#include <string>
#include <iostream>
int applyTransforms(int argc, char* argv[]);
#include "antsRegistration.h"
#include "itkNiftiImageIOFactory.h"
#include "itkMatlabTransformIOFactory.h"
#include "itkTxtTransformIOFactory.h"
#include "itkMultiThreaderBase.h"
#include <iostream>
int main(int argc, char* argv[]) {
  itk::NiftiImageIOFactory::RegisterOneFactory();
  itk::MatlabTransformIOFactory::RegisterOneFactory();
  itk::TxtTransformIOFactory::RegisterOneFactory();
  itk::MultiThreaderBase::SetGlobalDefaultNumberOfThreads(1);
  itk::MultiThreaderBase::SetGlobalDefaultThreader(itk::MultiThreaderBase::ThreaderEnum::Platform);
  try {
    if(argc>1 && std::string(argv[1])=="--apply")return applyTransforms(argc,argv);
    return ants::antsRegistration(std::vector<std::string>(argv + 1, argv + argc), nullptr);
  }
  catch (const std::exception& e) { std::cerr << e.what() << std::endl; return 1; }
}
