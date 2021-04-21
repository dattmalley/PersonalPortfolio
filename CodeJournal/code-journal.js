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

// Arrow Functions

const theFunction = () => 'I am awesome'

// a higher order funciton is a funciton that accepts another funciton as a parameter.
// filter, map and reduce are the most poluar, but forEach, ever, find, and some are also HOFs that we will be using in the Congress page.

// filter method example. Filter returns an array of all elements that 'pass the test'
// written as Array.prototype.filter() | array.prototype.map() | 

const pilots = [
{
  id: 2,
  name: "Wedge Antilles",
  faction: "Rebels"
},
{
  id: 8,
  name: "Ciena Ree",
  faction: "Empire"
},
{
  id: 40, 
  name: "Iden Versio",
  faction: "Empire"
},
{
  id: 66,
  name: "Thane Kyrell",
  faction: "Rebels"
}
];

const rebels = pilots.filter(pilot => pilot.faction === 'Rebels') //you can name it anything you want. because they are pilots we named it that.
const empire = pilots.filter((pilot) => {
  return pilot.faction === 'Empire'
})

// don't need double (()) but if you want you can. 
// need a return statement because you are asking for more than one filter.

//aaray helper method 'map'

const pilotsWithDate = pilots.map(pilot => {
  let date = new Date();
  pilot.date = Date.now().toLocaleDateString("en-US")
  return pilot;
});


