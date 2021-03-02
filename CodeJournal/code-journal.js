// variables - containters that store values

var name // a declared variable, but not initialized (no value) and it's in the global scpoe (BAD)

let foo // a delcard variable that can be changed

const bar = 'Bar' // a declared variable that cannot be changed - short for 'constant'

// '=' is the assignment operator, read it as "is assigned the value of..."

const ANSWER = 42 // a constant cannot be reassigned a value. but a LET can be reassigned.

// Strings 

let string1 = "Hello World!"

let string 2 = "Hello Utah!"

let string3 = new String("Hello New World!")

// Numbers

let myNum = 29492405386483048320043894280242

let myNum2 = 75.48

"1" == 1 // true, because of type coercion(forcing something to happen) and loose equality checking
"1" === 1 // false, because this is strict equality checking

// Boolean

let myBool = true

// Array 

let myArray = [] // this is an empty array

let myArray2 = [42, "bob", myBool, ANSWER, true]

myArray2.length

// Object

let minObject = {}

const myCar = {
    make: 'Chevrolet',
    color: 'Red',
    year: '1965',
    vin: '12k2kfid3n9na8331490',
}

myCar.numdoors = 2

const anotherObject = {
  words: ['foo', 'bar', 'ba'],
  car: {
    make: 'McLaren',
    model: '445',
  },
  awesome: true
}

// Function

function myFunction() {
  return 'My friend is a nice guy...'
}

function sumTwoThings(one, two) {
  return one + two;
}
